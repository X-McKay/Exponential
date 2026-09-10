// ================= agent runner =================
//
// A run gives an agent the live state of one project as context, asks the
// configured LLM for a structured reply, and stores the result as a fact.
// Everything the Agents page shows (status, counts, success, last run) is
// derived from stored runs; the runner never writes derived values.

import type { Database } from "bun:sqlite";
import {
  GSTATUS_LABEL,
  STATUS_LABEL,
  calendarOf,
  deriveDev,
  deriveUpcoming,
  isDue,
  metricLevel,
  monthLabel,
  nextRunId,
  realized,
  recentEvents,
  releaseState,
  tierOf,
} from "@valueflow/domain";
import type { Agent, AgentKind, AgentRun, AppState, Calendar, Project, ProjectTab } from "@valueflow/domain";
import type { RunAgentInput } from "@valueflow/shared";
import { extractJson } from "./llm.ts";
import type { ChatMessage, Llm } from "./llm.ts";
import { NotFound, findProject, insertRun, loadState, updateRun } from "./repo.ts";

// ---- context ---------------------------------------------------------------

const pct = (n: number): string => `${n}%`;

/** A compact, factual briefing on one project; the only thing the model knows. */
export const projectContext = (state: AppState, p: Project, cal: Calendar): string => {
  const lines: string[] = [];
  lines.push(`# ${p.name} (${p.key}) — stage ${p.stage}, AI risk tier ${p.tier ?? "untiered"}${p.committee ? `, committee approved ${p.committee.date} (${p.committee.ref})` : ", committee review pending"}`);
  lines.push(`As of ${cal.asOf.slice(0, 10)}. ${p.description}`);
  lines.push(`Targets: FTE reduction ${pct(p.targets.fte)}, time reduction ${pct(p.targets.time)}. Realized so far: FTE ${pct(realized(p, "fte"))}, time ${pct(realized(p, "time"))}.`);
  lines.push(`Team: ${p.team.map((t) => `${t.name} (${t.ini}, ${t.role})`).join("; ") || "none"}. Repos: ${p.repos.map((r) => r.name).join(", ") || "none"}.`);

  lines.push("\n## Milestones (value counts only when shipped AND eval metrics clear a gate)");
  for (const m of p.milestones) {
    const tier = tierOf(m);
    const gate = tier === 2 ? "clears STRETCH gate" : tier === 1 ? "clears BASE gate" : m.metrics.length ? "below base gate" : "no metrics defined";
    lines.push(`- ${m.id} ${m.name} — ${STATUS_LABEL[m.status]}, ${monthLabel(m.month, cal.todayYm)}; impact base FTE ${pct(m.impact.base.fte)}/time ${pct(m.impact.base.time)}, stretch FTE ${pct(m.impact.stretch.fte)}/time ${pct(m.impact.stretch.time)}; ${gate}`);
    for (const x of m.metrics) lines.push(`    · ${x.label}: ${x.current}% (base ≥${x.base}, stretch ≥${x.stretch}) → ${metricLevel(x)}`);
  }

  lines.push("\n## Governance");
  for (const g of p.governance) lines.push(`- [${g.cat}] ${g.name}: ${GSTATUS_LABEL[g.status]}, owner ${g.owner}${g.date ? `, ${g.date}` : ""}${g.detail ? ` — ${g.detail}` : ""}`);

  lines.push("\n## Releases (go live only when every criterion is met against live state)");
  for (const r of state.releases[p.id] ?? []) {
    const st = releaseState(r, p, cal);
    lines.push(`- ${r.id} ${r.name} — target ${monthLabel(r.month, cal.todayYm)}, ${st.label}, ${st.met}/${st.total} criteria met; ships ${r.milestoneIds.join(", ") || "nothing"}`);
    r.criteria.forEach((c, i) => {
      const e = st.evals[i];
      lines.push(`    · ${e?.ok ? "MET" : e?.pending ? "PENDING" : "NOT MET"}: ${c.label} (${e?.sub ?? ""})`);
    });
  }

  const facts = state.dev[p.id];
  if (facts) {
    const d = deriveDev(facts, p.team, cal.asOf);
    lines.push("\n## Development (synced from source control and CI)");
    lines.push(
      `Coverage ${d.stats.coverage === null ? "n/a" : pct(d.stats.coverage)}, quality ${d.stats.quality ?? "n/a"}, build success 30d ${d.stats.buildPass === null ? "n/a" : pct(d.stats.buildPass)}, ${d.stats.mergedPRs} PRs merged in 30d, ${d.stats.deploys} deploys, ${d.totalCommits} commits in 8 weeks.`,
    );
    for (const r of d.repos) lines.push(`- repo ${r.repo} (${r.branch}${r.lang ? `, ${r.lang}` : ""})${r.coverage !== null ? `, coverage ${pct(r.coverage)}` : ""}${r.quality ? `, quality ${r.quality}` : ""}`);
    for (const pr of d.prs.filter((x) => x.status === "open").slice(0, 8)) lines.push(`- open PR #${pr.number} ${pr.title} (${pr.repo}, ${pr.author}, checks ${pr.checks}, +${pr.add}/−${pr.del})`);
    for (const b of d.builds.filter((x) => x.status === "fail").slice(0, 5)) lines.push(`- FAILED build ${b.id} on ${b.repo} ${b.branch}: ${b.note}`);
  }

  const events = recentEvents(state.events, cal.asOf, 7 * 24).filter((e) => e.proj === p.id).slice(0, 12);
  if (events.length) {
    lines.push("\n## Recent activity (last 7 days)");
    for (const e of events) lines.push(`- ${e.at.slice(0, 10)} [${e.type}] ${e.text}`);
  }
  const up = deriveUpcoming(state, cal, 20).filter((u) => u.proj === p.id).slice(0, 6);
  if (up.length) {
    lines.push("\n## Coming up");
    for (const u of up) lines.push(`- ${u.date}: ${u.text}${u.sub ? ` — ${u.sub}` : ""}`);
  }
  return lines.join("\n");
};

// ---- prompts ---------------------------------------------------------------

const ROLE: Record<AgentKind, { brief: string; task: string; tab: ProjectTab }> = {
  deck: {
    brief: "You produce slide decks for executives and governance committees from project state.",
    task: "Produce a slide-by-slide outline of 8–12 slides in markdown: each slide is a `##` heading followed by 3–5 tight bullets. Open with the value picture (targets vs realized), then gates, releases, governance, risks, and asks. Quote every number exactly as given.",
    tab: "value",
  },
  comms: {
    brief: "You draft communications: release notes, stakeholder updates, decision memos, meeting follow-ups.",
    task: "Write the communication requested (default: a weekly stakeholder update) in markdown, at most 350 words, in a plain, direct tone for a business audience. Lead with what changed and what needs a decision. Quote numbers exactly.",
    tab: "value",
  },
  ideation: {
    brief: "You are an ideation partner: divergent options, prior art, structured concept development.",
    task: "Produce 8–12 concrete options as a markdown list. Each option: a bold title, a one-line rationale grounded in the context, effort (S/M/L), and which milestone or metric it moves. Rank by expected impact on realized value.",
    tab: "value",
  },
  audit: {
    brief: "You audit AI projects for security auditability, code-quality habits, governance drift, and product-management practice gaps.",
    task: "Report findings ordered by severity in markdown. Each finding: a `##` title, the evidence (cite the specific fact from the context), the risk, and a concrete recommendation. Set attention=true only when a finding needs a human decision this week: Tier 1 exposure, a release blocked by a governance gap, or failing CI on release-critical work. Otherwise attention=false.",
    tab: "governance",
  },
};

const RESULT_SCHEMA = {
  name: "agent_result",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string", description: "One line, at most 120 characters, naming what was produced or found." },
      attention: { type: "boolean", description: "True only if a human needs to act on this run this week." },
      body: { type: "string", description: "The full output in markdown." },
    },
    required: ["summary", "attention", "body"],
  },
};

interface AgentResult {
  summary: string;
  attention: boolean;
  body: string;
}

/** Cut at a word boundary with an ellipsis when the model overruns the one-line limit. */
const clip = (s: string, max: number): string => {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${space > max * 0.6 ? cut.slice(0, space) : cut}…`;
};

const parseResult = (text: string): AgentResult => {
  const raw = extractJson(text);
  if (typeof raw !== "object" || raw === null) throw new Error("reply is not an object");
  const o = raw as Record<string, unknown>;
  if (typeof o.summary !== "string" || typeof o.body !== "string") throw new Error("reply is missing summary or body");
  return { summary: clip(o.summary.trim(), 140), attention: o.attention === true, body: o.body.trim() };
};

export const buildMessages = (agent: Agent, state: AppState, p: Project, cal: Calendar, instruction: string | null): ChatMessage[] => {
  const role = ROLE[agent.kind];
  return [
    {
      role: "system",
      content: [
        `You are ${agent.name}, a workspace agent in ValueFlow, an AI-project delivery platform. ${role.brief}`,
        `Capabilities: ${agent.caps.join(", ")}.`,
        "Use only the facts in the briefing; never invent numbers, people, or dates. If something is missing, say so.",
        role.task,
        'Reply with a JSON object: {"summary": string, "attention": boolean, "body": string}.',
      ].join("\n"),
    },
    { role: "user", content: `${instruction ? `Instruction: ${instruction}\n\n` : ""}Briefing:\n\n${projectContext(state, p, cal)}` },
  ];
};

// ---- running ---------------------------------------------------------------

export const runAgent = async (db: Database, llm: Llm, input: RunAgentInput, now: Date): Promise<AgentRun> => {
  const state = loadState(db, now);
  const agent = state.agents.find((a) => a.id === input.agentId);
  if (!agent) throw new NotFound(`agent ${input.agentId} not found`);
  const project = findProject(state, input.proj);
  const cal = calendarOf(state);
  const run: AgentRun = {
    id: nextRunId(state.runs),
    agentId: agent.id,
    proj: project.id,
    tab: input.tab ?? ROLE[agent.kind].tab,
    state: "working",
    startedAt: now.toISOString(),
    finishedAt: null,
    instruction: input.instruction ?? null,
    summary: `${agent.name} is working on ${project.name}…`,
    output: "",
    model: null,
    error: null,
  };
  insertRun(db, run);
  try {
    const res = await llm.chat(buildMessages(agent, state, project, cal, run.instruction), { jsonSchema: RESULT_SCHEMA, maxTokens: 2200 });
    const result = parseResult(res.content);
    const finished: AgentRun = {
      ...run,
      state: result.attention ? "attention" : "done",
      finishedAt: new Date().toISOString(),
      summary: result.summary,
      output: result.body,
      model: res.model,
    };
    updateRun(db, finished);
    return finished;
  } catch (e) {
    const failed: AgentRun = { ...run, state: "failed", finishedAt: new Date().toISOString(), summary: `${agent.name} run failed`, error: e instanceof Error ? e.message : String(e) };
    updateRun(db, failed);
    return failed;
  }
};

/** Run every scheduled agent that is due, once per project. */
export const runDue = async (db: Database, llm: Llm, now: Date): Promise<AgentRun[]> => {
  const state = loadState(db, now);
  const out: AgentRun[] = [];
  for (const agent of state.agents) {
    if (!isDue(agent, state.runs, now.toISOString())) continue;
    for (const p of state.projects) out.push(await runAgent(db, llm, { agentId: agent.id, proj: p.id }, now));
  }
  return out;
};
