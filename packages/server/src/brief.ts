// ================= weekly brief =================
//
// One person, one Monday note: what moved, what is blocked, decisions waiting
// on them, and proposals pending. The brief is a run of the "brief" agent over
// the whole workspace (no project), stored like any run and scored like any
// run. Delivery is optional: a webhook receives the same text.

import type { Database } from "bun:sqlite";
import { GSTATUS_LABEL, calendarOf, composeGlancePage, describeAction, deriveUpcoming, nextRunId, pendingProposals, recentEvents } from "@valueflow/domain";
import type { Agent, AgentRun, AppState, Calendar } from "@valueflow/domain";
import { clip } from "./agents.ts";
import { workspaceBriefing } from "./chat.ts";
import { ruleScores } from "./evals.ts";
import { extractJson } from "./llm.ts";
import type { ChatMessage, Llm } from "./llm.ts";
import { promptVersion } from "./prompts.ts";
import { insertRun, loadState, updateRun, upsertScore } from "./repo.ts";

/** What a delivered brief looks like on the wire (Slack-compatible `text`, plus the parts). */
export interface BriefMessage {
  text: string;
  title: string;
  summary: string;
  body: string;
  runId: string;
  to: string;
}

export type BriefDelivery = (message: BriefMessage) => Promise<boolean>;

/** POST the brief as JSON to a webhook (Slack, Teams, Zapier, your own). */
export const webhookDelivery = (url: string, doFetch: typeof fetch = fetch): BriefDelivery => {
  return async (message) => {
    const res = await doFetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(message), signal: AbortSignal.timeout(20_000) });
    return res.ok;
  };
};

/** Everything the brief may draw on: the workspace, the week's movement, and what waits on the reader. */
export const briefContext = (state: AppState, cal: Calendar): string => {
  const user = state.workspace.user;
  const glance = composeGlancePage(state, cal);
  const week = recentEvents(state.events, cal.asOf, 7 * 24);
  const pending = pendingProposals(state);
  const name = (pid: string | null) => state.projects.find((p) => p.id === pid)?.name ?? "workspace";
  const mine = state.projects.flatMap((p) => p.governance.filter((g) => g.owner === user.ini && (g.status === "draft" || g.status === "in_review" || g.status === "missing")).map((g) => `- ${p.name}: ${g.name} is ${GSTATUS_LABEL[g.status]}`));
  const flagged = state.runs.filter((r) => r.state === "attention" && r.startedAt >= new Date(new Date(cal.asOf).getTime() - 7 * 86_400_000).toISOString()).slice(0, 6);
  const agentName = (id: string) => state.agents.find((a) => a.id === id)?.name ?? id;
  return [
    `# Brief for ${user.name} (${user.ini}), week of ${cal.asOf.slice(0, 10)}`,
    `\n## The portfolio in one breath\n${glance.narrative.join(" ")}`,
    `\n## What moved this week (${week.length} events)\n${week.length ? week.slice(0, 25).map((e) => `- ${e.at.slice(0, 10)} [${name(e.proj)}] ${e.text}`).join("\n") : "- nothing recorded"}`,
    `\n## Decisions waiting on ${user.name}\n${mine.length ? mine.join("\n") : "- no governance items owned by them are open"}`,
    `\n## Proposals pending (${pending.length})\n${pending.length ? pending.slice(0, 12).map((p) => `- ${p.id} from ${agentName(p.agentId)} on ${name(p.proj)}: ${describeAction(p.action, state, p.proj)} — ${p.rationale}`).join("\n") : "- none"}`,
    `\n## Agent flags this week\n${flagged.length ? flagged.map((r) => `- ${agentName(r.agentId)} on ${name(r.proj)}: ${r.summary}`).join("\n") : "- none"}`,
    `\n## Coming up (next two weeks)\n${deriveUpcoming(state, cal, 10).map((u) => `- ${u.date} [${name(u.proj)}] ${u.text}${u.sub ? ` — ${u.sub}` : ""}`).join("\n") || "- nothing scheduled"}`,
    `\n${workspaceBriefing(state, cal)}`,
  ].join("\n");
};

const BRIEF_SCHEMA = {
  name: "weekly_brief",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string", description: "One line, at most 120 characters: the week in a sentence." },
      body: { type: "string", description: "The brief in markdown, under 400 words, with these `##` sections in order: What moved, What is blocked, Decisions waiting on you, Proposals pending. Numbers exact." },
      links: {
        type: "array",
        maxItems: 6,
        items: { type: "object", additionalProperties: false, properties: { label: { type: "string" }, proj: { type: "string" }, tab: { type: "string", enum: ["overview", "value", "roadmap", "development", "governance"] } }, required: ["label", "proj", "tab"] },
      },
    },
    required: ["summary", "body", "links"],
  },
};

export const buildBriefMessages = (agent: Agent, state: AppState, cal: Calendar): ChatMessage[] => [
  {
    role: "system",
    content: [
      `You are ${agent.name}, the weekly-brief agent in ValueFlow, an AI-project delivery platform. You write one person's Monday brief from the facts below and nothing else.`,
      "Write for someone who has three minutes: lead with what changed and what needs their decision. Under 400 words. Sections, in order: What moved, What is blocked, Decisions waiting on you, Proposals pending. Name projects and numbers exactly as given; if a section has nothing, say so in one line.",
      "Address the reader directly. No greetings, no sign-off, no filler.",
      ...(agent.prompt ? [`\nAdditional instructions from the workspace:\n${agent.prompt}`] : []),
      'Reply with a JSON object: {"summary": string, "body": string, "links": [{"label","proj","tab"}]}.',
    ].join("\n"),
  },
  { role: "user", content: briefContext(state, cal) },
];

export interface BriefOptions {
  deliver?: BriefDelivery | null;
}

/** Write this week's brief, store it as a run, and deliver it if a channel is configured. */
export const runBrief = async (db: Database, llm: Llm, agent: Agent, now: Date, options: BriefOptions = {}): Promise<AgentRun> => {
  const state = loadState(db, now);
  const cal = calendarOf(state);
  const messages = buildBriefMessages(agent, state, cal);
  const briefing = messages[1]?.content ?? "";
  const started = Date.now();
  const run: AgentRun = {
    id: nextRunId(state.runs),
    agentId: agent.id,
    proj: null,
    tab: "overview",
    state: "working",
    startedAt: now.toISOString(),
    finishedAt: null,
    instruction: `Weekly brief for ${state.workspace.user.name}`,
    summary: `${agent.name} is writing the brief…`,
    output: "",
    model: null,
    error: null,
    promptVersion: promptVersion("brief", agent.prompt),
    latencyMs: null,
    promptTokens: null,
    completionTokens: null,
    benchmark: null,
    rating: null,
    ratingNote: null,
  };
  insertRun(db, run, briefing);
  try {
    const res = await llm.chat(messages, { jsonSchema: BRIEF_SCHEMA, maxTokens: 2500, temperature: 0.2, model: agent.model });
    const raw = extractJson(res.content);
    const o = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    if (typeof o.summary !== "string" || typeof o.body !== "string" || !o.body.trim()) throw new Error("reply is missing summary or body");
    const links = (Array.isArray(o.links) ? o.links : [])
      .map((l) => (typeof l === "object" && l !== null ? (l as Record<string, unknown>) : {}))
      .filter((l) => typeof l.label === "string" && state.projects.some((p) => p.id === l.proj))
      .map((l) => `- ${String(l.label)} — ${state.projects.find((p) => p.id === l.proj)?.name ?? ""} (${String(l.tab)})`);
    const body = `${o.body.trim()}${links.length ? `\n\n## Where to look\n${links.join("\n")}` : ""}`;
    const finished: AgentRun = { ...run, state: "done", finishedAt: new Date().toISOString(), summary: clip(o.summary.trim(), 140), output: body, model: res.model, latencyMs: Date.now() - started, promptTokens: res.usage?.prompt ?? null, completionTokens: res.usage?.completion ?? null };
    let delivered: string | null = null;
    if (options.deliver) {
      const title = `Your week — ${cal.asOf.slice(0, 10)}`;
      try {
        const ok = await options.deliver({ text: `*${title}*\n${finished.summary}\n\n${body}`, title, summary: finished.summary, body, runId: run.id, to: state.workspace.user.name });
        delivered = ok ? `Delivered to the configured channel at ${new Date().toISOString().slice(11, 16)} UTC.` : "Delivery failed: the channel did not accept the message.";
      } catch (e) {
        delivered = `Delivery failed: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
    const stored: AgentRun = { ...finished, output: delivered ? `${body}\n\n_${delivered}_` : body };
    updateRun(db, stored);
    for (const s of ruleScores({ run: stored, briefing, proposalsReturned: 0, proposalsKept: 0 }, stored.finishedAt ?? now.toISOString())) upsertScore(db, s);
    return stored;
  } catch (e) {
    const failed: AgentRun = { ...run, state: "failed", finishedAt: new Date().toISOString(), summary: "The brief could not be written", error: e instanceof Error ? e.message : String(e), latencyMs: Date.now() - started };
    updateRun(db, failed);
    return failed;
  }
};
