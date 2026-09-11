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
  metricLevel,
  monthLabel,
  nextProposalId,
  nextRunId,
  realized,
  recentEvents,
  releaseState,
  tierOf,
} from "@valueflow/domain";
import type { Agent, AgentRun, AppState, Calendar, Project, Proposal, Rule } from "@valueflow/domain";
import { ProposalActionSchema } from "@valueflow/shared";
import type { RunAgentInput } from "@valueflow/shared";
import { extractJson } from "./llm.ts";
import type { ChatMessage, Llm } from "./llm.ts";
import { ruleScores } from "./evals.ts";
import { PROPOSAL_SHAPES, ROLE, promptVersion, proposalShapeLines, resultSchema } from "./prompts.ts";
import { acceptProposal } from "./proposals.ts";
import { Conflict, NotFound, findProject, insertProposal, insertRun, loadState, updateRun, upsertScore } from "./repo.ts";

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
  for (const g of p.governance) lines.push(`- [${g.cat}] ${g.name} (id: ${g.id}): ${GSTATUS_LABEL[g.status]}, owner ${g.owner}${g.date ? `, ${g.date}` : ""}${g.detail ? ` — ${g.detail}` : ""}`);

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

// ---- results -----------------------------------------------------------------

export { PROPOSAL_SHAPES, promptVersion };

interface AgentResult {
  summary: string;
  attention: boolean;
  body: string;
  proposals: { action: Proposal["action"]; rationale: string; ruleId: string | null }[];
  proposalsReturned: number;
}

/** Keep only proposals the schema accepts and that point at things the project has. */
const parseProposals = (raw: unknown, p: Project, rules: Rule[]): AgentResult["proposals"] => {
  if (!Array.isArray(raw)) return [];
  const out: AgentResult["proposals"] = [];
  for (const item of raw.slice(0, 6)) {
    if (typeof item !== "object" || item === null) continue;
    const { rationale, rule, ...rest } = item as Record<string, unknown>;
    const parsed = ProposalActionSchema.safeParse(rest);
    if (!parsed.success) continue;
    const a = parsed.data;
    // Agents change project facts; their own prompts and models are the tuner's and scout's business.
    if (a.type === "agent_prompt" || a.type === "agent_model") continue;
    // Targets must exist, and a status "change" to the current status is noise.
    if (a.type === "governance_status" && !p.governance.some((g) => g.id === a.gid && g.status !== a.status)) continue;
    if (a.type === "milestone_status" && !p.milestones.some((m) => m.id === a.mid && m.status !== a.status)) continue;
    if (a.type === "governance_item" && p.governance.some((g) => g.name.toLowerCase() === a.name.toLowerCase())) continue;
    const ruleId = typeof rule === "string" && rules.some((r) => r.id === rule) ? rule : null;
    // A rules run must tie every proposal to a rule; anything else is the model freelancing.
    if (rules.length && !ruleId) continue;
    out.push({ action: a, rationale: typeof rationale === "string" ? rationale.trim().slice(0, 400) : "", ruleId });
  }
  return out;
};

/** Cut at a word boundary with an ellipsis when the model overruns the one-line limit. */
export const clip = (s: string, max: number): string => {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${space > max * 0.6 ? cut.slice(0, space) : cut}…`;
};

const parseResult = (text: string, p: Project, rules: Rule[]): AgentResult => {
  const raw = extractJson(text);
  if (typeof raw !== "object" || raw === null) throw new Error("reply is not an object");
  const o = raw as Record<string, unknown>;
  if (typeof o.summary !== "string" || typeof o.body !== "string") throw new Error("reply is missing summary or body");
  return { summary: clip(o.summary.trim(), 140), attention: o.attention === true, body: o.body.trim(), proposals: parseProposals(o.proposals, p, rules), proposalsReturned: Array.isArray(o.proposals) ? o.proposals.length : 0 };
};

/** The standing rules that apply to a project, for the rules agent. */
export const rulesFor = (state: Pick<AppState, "rules">, p: Pick<Project, "id">): Rule[] => state.rules.filter((r) => r.enabled && (r.proj === null || r.proj === p.id));

export const buildMessages = (agent: Agent, state: AppState, p: Project, cal: Calendar, instruction: string | null, rules: Rule[] = []): ChatMessage[] => {
  const role = ROLE[agent.kind];
  const ruleBlock = rules.length ? `\n\nStanding rules to check (cite the id in every proposal's "rule" field):\n${rules.map((r) => `- ${r.id} (owner ${r.owner}): ${r.text}`).join("\n")}` : "";
  return [
    {
      role: "system",
      content: [
        `You are ${agent.name}, a workspace agent in ValueFlow, an AI-project delivery platform. ${role.brief}`,
        `Capabilities: ${agent.caps.join(", ")}.`,
        "Use only the facts in the briefing; never invent numbers, people, or dates. If something is missing, say so.",
        role.task,
        "You may also propose concrete changes a person can accept with one click. Each proposal must use exactly one of these shapes, with the values in the named fields (not in the rationale):",
        ...proposalShapeLines(rules.length > 0),
        "Propose a status change only when the briefing shows it has actually happened or been decided (for example a review that is described as complete but still marked In review). To ask for work or a decision, propose a calendar_event with the date it is needed by instead. Propose only what the evidence supports; an empty list is fine. Never propose a status the item already has.",
        'Reply with a JSON object: {"summary": string, "attention": boolean, "body": string, "proposals": [...]}.',
        ...(agent.prompt ? [`\nAdditional instructions from the workspace (follow these; they refine the task above):\n${agent.prompt}`] : []),
      ].join("\n"),
    },
    { role: "user", content: `${instruction ? `Instruction: ${instruction}\n\n` : ""}Briefing:\n\n${projectContext(state, p, cal)}${ruleBlock}` },
  ];
};

// ---- running ---------------------------------------------------------------

export interface RunOptions {
  /** Benchmark case id when the run belongs to a benchmark. */
  benchmark?: string;
  /** Model to use for this run instead of the agent's (the scout compares candidates this way). */
  model?: string;
}

/** Run a project-scoped agent (deck, comms, ideation, audit, chat, rules) against one project. */
export const runAgent = async (db: Database, llm: Llm, input: RunAgentInput, now: Date, options: RunOptions = {}): Promise<AgentRun> => {
  const state = loadState(db, now);
  const agent = state.agents.find((a) => a.id === input.agentId);
  if (!agent) throw new NotFound(`agent ${input.agentId} not found`);
  if (!input.proj) throw new Conflict(`${agent.name} needs a project to run against`);
  const project = findProject(state, input.proj);
  const cal = calendarOf(state);
  const rules = agent.kind === "rules" ? rulesFor(state, project) : [];
  if (agent.kind === "rules" && rules.length === 0) throw new Conflict(`no enabled standing rules apply to ${project.name}`);
  const messages = buildMessages(agent, state, project, cal, input.instruction ?? null, rules);
  const briefing = messages[1]?.content ?? "";
  const started = Date.now();
  const model = options.model ?? agent.model ?? null;
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
    promptVersion: promptVersion(agent.kind, agent.prompt),
    latencyMs: null,
    promptTokens: null,
    completionTokens: null,
    benchmark: options.benchmark ?? null,
    rating: null,
    ratingNote: null,
  };
  insertRun(db, run, briefing);
  const schema = resultSchema(rules.length > 0);
  try {
    let res = await llm.chat(messages, { jsonSchema: schema, maxTokens: 4000, model });
    if (res.truncated) {
      // The reply hit the budget mid-JSON. Ask once more, tersely, with more room.
      const terse: ChatMessage[] = [...messages, { role: "assistant", content: res.content.slice(0, 400) }, { role: "user", content: "That reply was cut off before the JSON closed. Reply again, complete and valid, keeping the body under 500 words and at most 4 proposals." }];
      res = await llm.chat(terse, { jsonSchema: schema, maxTokens: 6000, model });
    }
    let result: AgentResult;
    try {
      result = parseResult(res.content, project, rules);
    } catch (e) {
      throw new Error(`${e instanceof Error ? e.message : String(e)} (reply began: ${JSON.stringify(res.content.slice(0, 200))})`, { cause: e });
    }
    const finished: AgentRun = {
      ...run,
      state: result.attention ? "attention" : "done",
      finishedAt: new Date().toISOString(),
      summary: result.summary,
      output: result.body,
      model: res.model,
      latencyMs: Date.now() - started,
      promptTokens: res.usage?.prompt ?? null,
      completionTokens: res.usage?.completion ?? null,
    };
    updateRun(db, finished);
    let existing = loadState(db, now).proposals;
    // A benchmark run measures what the agent would propose; it does not fill the inbox with it.
    for (const pr of options.benchmark ? [] : result.proposals) {
      const proposal: Proposal = { id: nextProposalId(existing), runId: run.id, agentId: agent.id, proj: project.id, ruleId: pr.ruleId, action: pr.action, rationale: pr.rationale, state: "pending", createdAt: finished.finishedAt ?? now.toISOString(), decidedAt: null };
      insertProposal(db, proposal);
      existing = [...existing, proposal];
      // A rule that earned autonomy applies its proposals at once; the proposal stays as the record of what happened.
      const rule = rules.find((r) => r.id === pr.ruleId);
      if (rule?.auto) {
        try {
          acceptProposal(db, proposal, new Date());
        } catch (e) {
          console.error(`rule ${rule.id}: could not apply ${proposal.id}`, e instanceof Error ? e.message : e);
        }
      }
    }
    for (const s of ruleScores({ run: finished, briefing, proposalsReturned: result.proposalsReturned, proposalsKept: result.proposals.length }, finished.finishedAt ?? now.toISOString())) upsertScore(db, s);
    return finished;
  } catch (e) {
    const failed: AgentRun = { ...run, state: "failed", finishedAt: new Date().toISOString(), summary: `${agent.name} run failed`, error: e instanceof Error ? e.message : String(e), latencyMs: Date.now() - started };
    updateRun(db, failed);
    for (const s of ruleScores({ run: failed, briefing, proposalsReturned: 0, proposalsKept: 0 }, failed.finishedAt ?? now.toISOString())) upsertScore(db, s);
    return failed;
  }
};
