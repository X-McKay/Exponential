// ================= workspace conversation =================
//
// One question box over the whole workspace. The model is briefed with a
// compact summary of every project (and the full briefing of the project the
// user is looking at), answers from that only, points at the right page, and
// may draft proposals. Every turn is stored as a run of the built-in "ask"
// agent, so conversations are audited and evaluated like any other run.

import type { Database } from "bun:sqlite";
import {
  GSTATUS_LABEL,
  PROJECT_TABS,
  STATUS_LABEL,
  blockers,
  calendarOf,
  deriveUpcoming,
  monthLabel,
  nextProposalId,
  nextRunId,
  pendingProposals,
  readiness,
  realized,
  recentEvents,
  releaseState,
  tierOf,
} from "@valueflow/domain";
import type { Agent, AgentRun, AppState, Calendar, ProjectTab, Proposal } from "@valueflow/domain";
import { ProposalActionSchema } from "@valueflow/shared";
import type { ChatInput } from "@valueflow/shared";
import { clip, projectContext } from "./agents.ts";
import { promptVersion, shapesWith } from "./prompts.ts";
import { ruleScores } from "./evals.ts";
import { extractJson } from "./llm.ts";
import type { ChatMessage, Llm } from "./llm.ts";
import { replyDetail, trace } from "./live.ts";
import { NotFound, insertProposal, insertRun, loadState, updateRun, upsertScore } from "./repo.ts";

/** One paragraph per project plus what is moving across the workspace. */
export const workspaceBriefing = (state: AppState, cal: Calendar): string => {
  const lines: string[] = [`# Workspace as of ${cal.asOf.slice(0, 10)} — ${state.projects.length} projects`];
  for (const p of state.projects) {
    const rels = (state.releases[p.id] ?? []).map((r) => {
      const st = releaseState(r, p, cal);
      return `${r.id} ${r.name} (${monthLabel(r.month, cal.todayYm)}, ${st.label}, ${st.met}/${st.total})`;
    });
    lines.push(
      `\n## ${p.name} (id: ${p.id}, ${p.key}) — ${p.stage}, tier ${p.tier ?? "untiered"}. Targets FTE ${p.targets.fte}% / time ${p.targets.time}%; realized FTE ${realized(p, "fte")}% / time ${realized(p, "time")}%. Governance ${Math.round(readiness(p) * 100)}% ready, ${blockers(p)} missing.`,
    );
    for (const m of p.milestones) {
      const t = tierOf(m);
      lines.push(`- ${m.id} ${m.name}: ${STATUS_LABEL[m.status]}, ${monthLabel(m.month, cal.todayYm)}, ${t === 2 ? "stretch gate" : t === 1 ? "base gate" : m.metrics.length ? "below gate" : "no metrics"}${m.metrics.length ? ` (${m.metrics.map((x) => `${x.label} ${x.current}%/${x.base}`).join(", ")})` : ""}`);
    }
    if (rels.length) lines.push(`- Releases: ${rels.join("; ")}`);
    const gaps = p.governance.filter((g) => g.status === "missing" || g.status === "draft" || g.status === "in_review");
    if (gaps.length) lines.push(`- Governance open: ${gaps.map((g) => `${g.name} (id: ${g.id}, ${GSTATUS_LABEL[g.status]})`).join("; ")}`);
    const facts = state.dev[p.id];
    if (facts) {
      const failing = facts.prs.filter((x) => x.status === "open" && x.checks === "fail");
      const red = facts.builds.filter((b) => b.status === "fail");
      if (failing.length || red.length) lines.push(`- CI: ${failing.map((x) => `PR #${x.number} checks failing`).join(", ")}${failing.length && red.length ? "; " : ""}${red.map((b) => `build ${b.id} failed on ${b.repo}`).join(", ")}`);
    }
  }
  const recent = recentEvents(state.events, cal.asOf, 72).slice(0, 12);
  if (recent.length) lines.push(`\n## Last 3 days\n${recent.map((e) => `- ${e.at.slice(0, 10)} [${e.proj}] ${e.text}`).join("\n")}`);
  const up = deriveUpcoming(state, cal, 8);
  if (up.length) lines.push(`\n## Coming up\n${up.map((u) => `- ${u.date} [${u.proj}] ${u.text}${u.sub ? ` — ${u.sub}` : ""}`).join("\n")}`);
  const pending = pendingProposals(state);
  if (pending.length) lines.push(`\n## Proposals awaiting a decision: ${pending.length} (from ${[...new Set(pending.map((p) => p.agentId))].join(", ")})`);
  return lines.join("\n");
};

const ANSWER_SCHEMA = {
  name: "workspace_answer",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      answer: { type: "string", description: "The answer in markdown: direct, specific, numbers exact. Say when the briefing does not contain the answer." },
      links: {
        type: "array",
        maxItems: 4,
        description: "Pages worth opening for this answer.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: { label: { type: "string" }, proj: { type: "string", description: "project id from the briefing" }, tab: { type: "string", enum: [...PROJECT_TABS] } },
          required: ["label", "proj", "tab"],
        },
      },
      proposals: { type: "array", maxItems: 4, items: { anyOf: shapesWith("proj", "project id the change applies to") } },
    },
    required: ["answer", "links", "proposals"],
  },
};

export interface ChatReply {
  answer: string;
  links: { label: string; proj: string; tab: ProjectTab }[];
  proposals: Proposal[];
  runId: string;
  model: string;
}

const isTab = (s: unknown): s is ProjectTab => (PROJECT_TABS as readonly string[]).includes(String(s));

export const buildChatMessages = (state: AppState, cal: Calendar, input: ChatInput, ask: Pick<Agent, "prompt"> = { prompt: null }): ChatMessage[] => {
  const focus = input.proj ? state.projects.find((p) => p.id === input.proj) : undefined;
  const briefing = [workspaceBriefing(state, cal), focus ? `\n\n# The project the user is looking at, in full\n${projectContext(state, focus, cal)}` : ""].join("");
  return [
    {
      role: "system",
      content: [
        "You are Ask, the ValueFlow workspace assistant. ValueFlow tracks AI projects whose value counts only when milestones ship AND their eval metrics clear a gate; releases go live only when every criterion is met.",
        "Answer only from the briefing. Quote numbers exactly. If the briefing does not contain the answer, say so and point at where it would be. Be brief: a few sentences or a short list.",
        "Add links to the pages that show the evidence (tabs: overview, value, roadmap, development, governance).",
        "When the user asks for a change, or a change plainly follows from the facts, add a proposal using exactly one of these shapes with a proj field:",
        '  {"type":"governance_status","proj":"<project id>","gid":"<governance id>","status":"approved|in_review|draft|missing|na","rationale":"…"}',
        '  {"type":"milestone_status","proj":"<project id>","mid":"MS-n","status":"backlog|progress|eval|shipped","rationale":"…"}',
        '  {"type":"governance_item","proj":"<project id>","cat":"…","name":"…","status":"missing|draft|in_review|approved","owner":"<initials>","detail":"…","rationale":"…"}',
        '  {"type":"calendar_event","proj":"<project id>","date":"YYYY-MM-DD","text":"…","sub":null,"tab":"governance","rationale":"…"}',
        '  {"type":"targets","proj":"<project id>","fte":30,"time":50,"rationale":"…"}',
        "Never propose a status the item already has. Proposals are applied only when a person accepts them.",
        'Reply with a JSON object: {"answer": string, "links": [...], "proposals": [...]}.',
        ...(ask.prompt ? [`\nAdditional instructions from the workspace:\n${ask.prompt}`] : []),
        `\n${briefing}`,
      ].join("\n"),
    },
    ...input.messages.slice(-8).map((m): ChatMessage => ({ role: m.role, content: m.content })),
  ];
};

export const askWorkspace = async (db: Database, llm: Llm, input: ChatInput, now: Date): Promise<ChatReply> => {
  const state = loadState(db, now);
  const cal = calendarOf(state);
  const ask = state.agents.find((a) => a.kind === "chat");
  if (!ask) throw new NotFound("no conversational agent is installed");
  const question = input.messages[input.messages.length - 1]?.content ?? "";
  const messages = buildChatMessages(state, cal, input, ask);
  const started = Date.now();
  const focusProj = input.proj && state.projects.some((p) => p.id === input.proj) ? input.proj : null;
  const run: AgentRun = {
    id: nextRunId(state.runs),
    agentId: ask.id,
    proj: focusProj,
    tab: "overview",
    state: "working",
    startedAt: now.toISOString(),
    finishedAt: null,
    instruction: question.slice(0, 2000),
    summary: "Answering…",
    output: "",
    model: null,
    error: null,
    promptVersion: promptVersion("chat", ask.prompt),
    latencyMs: null,
    promptTokens: null,
    completionTokens: null,
    benchmark: null,
    rating: null,
    ratingNote: null,
  };
  insertRun(db, run, messages[0]?.content ?? "");
  const t = trace(db, run);
  t.step("briefing", `${state.projects.length} projects${focusProj ? `, ${state.projects.find((p) => p.id === focusProj)?.name ?? focusProj} in full` : ""}, ${input.messages.length} turn${input.messages.length === 1 ? "" : "s"} of conversation`);
  try {
    t.step("request", `${ask.model ?? llm.describe().model ?? "default model"}, JSON schema`);
    const asked = Date.now();
    const res = await llm.chat(messages, { jsonSchema: ANSWER_SCHEMA, maxTokens: 2000, temperature: 0.2, model: ask.model, onToken: t.token });
    t.step("reply", replyDetail(res.usage, Date.now() - asked, res.truncated));
    const raw = extractJson(res.content);
    const o = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    const answer = typeof o.answer === "string" ? o.answer.trim() : "";
    if (!answer) throw new Error("reply had no answer");
    const links = (Array.isArray(o.links) ? o.links : [])
      .map((l) => (typeof l === "object" && l !== null ? (l as Record<string, unknown>) : {}))
      .filter((l) => typeof l.label === "string" && typeof l.proj === "string" && isTab(l.tab) && state.projects.some((p) => p.id === l.proj))
      .map((l) => ({ label: String(l.label).slice(0, 80), proj: String(l.proj), tab: l.tab as ProjectTab }))
      .slice(0, 4);
    const rawProposals = Array.isArray(o.proposals) ? o.proposals : [];
    const finished: AgentRun = {
      ...run,
      state: "done",
      finishedAt: new Date().toISOString(),
      summary: clip(answer.split("\n").find((l) => l.trim()) ?? answer, 140),
      output: answer,
      model: res.model,
      latencyMs: Date.now() - started,
      promptTokens: res.usage?.prompt ?? null,
      completionTokens: res.usage?.completion ?? null,
    };
    updateRun(db, finished);
    t.step("parsed", `${links.length} link${links.length === 1 ? "" : "s"}, ${rawProposals.length} proposal${rawProposals.length === 1 ? "" : "s"} returned`);
    const proposals: Proposal[] = [];
    let existing = state.proposals;
    for (const item of rawProposals.slice(0, 4)) {
      if (typeof item !== "object" || item === null) continue;
      const { rationale, proj, ...rest } = item as Record<string, unknown>;
      const project = state.projects.find((p) => p.id === proj);
      const parsed = ProposalActionSchema.safeParse(rest);
      if (!project || !parsed.success) continue;
      const a = parsed.data;
      if (a.type === "agent_prompt" || a.type === "agent_model") continue;
      if (a.type === "governance_status" && !project.governance.some((g) => g.id === a.gid && g.status !== a.status)) continue;
      if (a.type === "milestone_status" && !project.milestones.some((m) => m.id === a.mid && m.status !== a.status)) continue;
      const proposal: Proposal = { id: nextProposalId(existing), runId: run.id, agentId: ask.id, proj: project.id, ruleId: null, action: a, rationale: typeof rationale === "string" ? rationale.slice(0, 400) : "", state: "pending", createdAt: finished.finishedAt ?? now.toISOString(), decidedAt: null };
      insertProposal(db, proposal);
      existing = [...existing, proposal];
      proposals.push(proposal);
    }
    if (rawProposals.length) t.step("proposals", `kept ${proposals.length} of ${rawProposals.length}`);
    const scores = ruleScores({ run: finished, briefing: messages[0]?.content ?? "", proposalsReturned: rawProposals.length, proposalsKept: proposals.length }, finished.finishedAt ?? now.toISOString());
    for (const s of scores) upsertScore(db, s);
    t.step("scored", scores.map((s) => `${s.dimension.replace("_", " ")} ${Math.round(s.score * 100)}%`).join(" · "));
    t.step("done", `answered in ${((finished.latencyMs ?? 0) / 1000).toFixed(1)}s`);
    t.finished("done");
    return { answer, links, proposals, runId: run.id, model: res.model };
  } catch (e) {
    const failed: AgentRun = { ...run, state: "failed", finishedAt: new Date().toISOString(), summary: "Ask could not answer", error: e instanceof Error ? e.message : String(e), latencyMs: Date.now() - started };
    updateRun(db, failed);
    t.step("failed", failed.error ?? "unknown error");
    t.finished("failed");
    throw e;
  }
};
