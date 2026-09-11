// ================= agent evals =================
//
// Every run is measured three ways, none of them stored as opinion:
//   rules  — deterministic checks: did the reply parse, do the numbers and
//            ids it cites exist in the briefing it was given, were its
//            proposals valid.
//   judge  — an LLM grader with a rubric per agent kind, blind to who made
//            the run, scoring groundedness, completeness, actionability and
//            clarity, plus the fixed expectations of a benchmark case.
//   people — a rating on the run, and whether its proposals were accepted.
// Benchmarks re-run a fixed case set so a prompt or model change can be
// compared against the previous batch instead of a feeling.

import type { Database } from "bun:sqlite";
import { EVAL_CASES, JUDGE_DIMENSIONS, ungroundedTokens } from "@valueflow/domain";
import type { AgentKind, AgentRun, EvalCase, RunScore } from "@valueflow/domain";
import { runAgent } from "./agents.ts";
import { curateGlance } from "./curator.ts";
import { extractJson } from "./llm.ts";
import type { Llm } from "./llm.ts";
import { NotFound, loadRunContext, loadState, upsertScore } from "./repo.ts";

// ---- rules -------------------------------------------------------------------

export interface RuleInput {
  run: AgentRun;
  briefing: string;
  /** Proposals the model returned vs those that survived validation. */
  proposalsReturned: number;
  proposalsKept: number;
  /** Layout placements the curator returned vs those that named a real card. */
  placements?: { returned: number; kept: number };
}

/** Deterministic scores for a finished run. */
export const ruleScores = (input: RuleInput, at: string): RunScore[] => {
  const { run, briefing } = input;
  const out: RunScore[] = [];
  const parsed = run.state !== "failed";
  out.push({ runId: run.id, scorer: "rules", dimension: "format", score: parsed ? (run.summary.length <= 140 && run.output.length > 0 ? 1 : 0.7) : 0, note: parsed ? "reply parsed; summary and body present" : (run.error ?? "reply unusable"), at });
  if (parsed) {
    const g = ungroundedTokens(run.output, briefing);
    if (g.cited.length > 0) {
      const score = 1 - g.missing.length / g.cited.length;
      out.push({ runId: run.id, scorer: "rules", dimension: "grounding", score, note: g.missing.length ? `${g.missing.length} of ${g.cited.length} cited figures not in the briefing: ${g.missing.slice(0, 6).join(", ")}` : `all ${g.cited.length} cited figures appear in the briefing`, at });
    }
  }
  if (input.proposalsReturned > 0) {
    out.push({ runId: run.id, scorer: "rules", dimension: "proposals_valid", score: input.proposalsKept / input.proposalsReturned, note: `${input.proposalsKept} of ${input.proposalsReturned} proposals well-formed and pointing at real items`, at });
  }
  if (input.placements && input.placements.returned > 0) {
    out.push({ runId: run.id, scorer: "rules", dimension: "layout_valid", score: input.placements.kept / input.placements.returned, note: `${input.placements.kept} of ${input.placements.returned} placements named a card the composer found`, at });
  }
  return out;
};

// ---- judge -------------------------------------------------------------------

const RUBRIC: Record<AgentKind, string> = {
  deck: "A slide outline of 8–12 slides for executives: value picture first, then gates, releases, governance, risks, asks; every number exact.",
  comms: "A business communication under 350 words that leads with what changed and what needs a decision; numbers exact; tone plain and direct.",
  ideation: "8–12 distinct, concrete options, each with rationale from the briefing, an effort size, and the milestone or metric it moves; ranked by impact on realized value.",
  audit: "Findings ordered by severity, each with evidence cited from the briefing, the risk, and a concrete recommendation; attention set only for decisions needed this week.",
  chat: "A direct answer to the question from the briefing only, with links to the right page and, where warranted, a well-formed proposal.",
  rules: "One verdict per standing rule (fires / does not fire) with the evidence from the briefing, and proposals only for rules that fired, each tied to its rule.",
  brief: "A weekly brief under 400 words for one person: what moved, what is blocked, decisions waiting on them, proposals pending; numbers exact; no padding.",
  tuner: "An evidence-based critique of an agent's recent runs and a concise, specific change to its extra instructions.",
  scout: "A factual comparison of models on the same benchmark with a recommendation only where the numbers justify it.",
  curator: "A layout of at most six cards chosen from the candidates only, sorted into decide / watch / know by what the reader must act on, each with a one-line reason grounded in the card's facts, under a headline of at most 120 characters. Blocked releases and Tier 1 gaps must not be hidden.",
};

const JUDGE_SCHEMA = {
  name: "run_judgement",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      groundedness: { type: "integer", minimum: 0, maximum: 10, description: "Every claim and number is traceable to the briefing; nothing invented." },
      completeness: { type: "integer", minimum: 0, maximum: 10, description: "Covers what the task and instruction asked for." },
      actionability: { type: "integer", minimum: 0, maximum: 10, description: "Specific enough to act on; recommendations name what, who, when." },
      clarity: { type: "integer", minimum: 0, maximum: 10, description: "Well structured, no padding, readable by the intended audience." },
      unsupported: { type: "array", maxItems: 8, items: { type: "string" }, description: "Claims or figures not supported by the briefing." },
      expectations: { type: "array", items: { type: "object", additionalProperties: false, properties: { expectation: { type: "string" }, met: { type: "boolean" }, why: { type: "string" } }, required: ["expectation", "met", "why"] } },
      critique: { type: "string", description: "Two or three sentences on the biggest weakness and how to fix it." },
    },
    required: ["groundedness", "completeness", "actionability", "clarity", "unsupported", "expectations", "critique"],
  },
};

interface Judgement {
  groundedness: number;
  completeness: number;
  actionability: number;
  clarity: number;
  unsupported: string[];
  expectations: { expectation: string; met: boolean; why: string }[];
  critique: string;
}

const tenth = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(10, Math.round(v))) : 0);

const parseJudgement = (text: string): Judgement => {
  const raw = extractJson(text);
  const o = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const exp = Array.isArray(o.expectations) ? o.expectations : [];
  return {
    groundedness: tenth(o.groundedness),
    completeness: tenth(o.completeness),
    actionability: tenth(o.actionability),
    clarity: tenth(o.clarity),
    unsupported: Array.isArray(o.unsupported) ? o.unsupported.filter((x): x is string => typeof x === "string").slice(0, 8) : [],
    expectations: exp
      .map((e) => {
        const v = typeof e === "object" && e !== null ? (e as Record<string, unknown>) : {};
        return { expectation: String(v.expectation ?? ""), met: v.met === true, why: String(v.why ?? "") };
      })
      .filter((e) => e.expectation),
    critique: typeof o.critique === "string" ? o.critique.trim().slice(0, 1200) : "",
  };
};

export const judgeMessages = (kind: AgentKind, run: AgentRun, briefing: string, expectations: string[]) => [
  {
    role: "system" as const,
    content: [
      "You are a strict, impartial evaluator of an AI agent's output for an AI-project delivery platform. You do not know which model produced it.",
      `The agent's task: ${RUBRIC[kind]}`,
      "Score each dimension 0–10. Groundedness is the most important: any number, name, date, or status not in the briefing counts against it, and you must list such claims under unsupported.",
      expectations.length ? "Then judge each listed expectation: met only if the output clearly satisfies it." : "There are no fixed expectations for this run; return an empty expectations list.",
      "Reply with a single JSON object matching the schema.",
    ].join("\n"),
  },
  {
    role: "user" as const,
    content: [
      `## Briefing the agent was given\n${briefing}`,
      run.instruction ? `## Instruction\n${run.instruction}` : "",
      `## Agent output\nSummary: ${run.summary}\nAttention: ${run.state === "attention"}\n\n${run.output}`,
      expectations.length ? `## Expectations\n${expectations.map((e, i) => `${i + 1}. ${e}`).join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
  },
];

/** Grade a finished run with the LLM judge and store the scores; returns them. */
export const judgeRun = async (db: Database, llm: Llm, runId: string, now: Date): Promise<RunScore[]> => {
  const state = loadState(db, now);
  const run = state.runs.find((r) => r.id === runId);
  if (!run) throw new NotFound(`run ${runId} not found`);
  if (run.state === "failed" || run.state === "working" || run.state === "queued") return [];
  const agent = state.agents.find((a) => a.id === run.agentId);
  const briefing = loadRunContext(db, runId) ?? "";
  const expectations = run.benchmark ? (EVAL_CASES.find((c) => c.id === run.benchmark)?.expectations ?? []) : [];
  const res = await llm.chat(judgeMessages(agent?.kind ?? "chat", run, briefing, expectations), { jsonSchema: JUDGE_SCHEMA, maxTokens: 1500, temperature: 0, model: llm.describe().judgeModel });
  const j = parseJudgement(res.content);
  const at = new Date().toISOString();
  const scores: RunScore[] = JUDGE_DIMENSIONS.map((d) => ({ runId, scorer: "judge", dimension: d, score: j[d] / 10, note: d === "groundedness" && j.unsupported.length ? `unsupported: ${j.unsupported.join("; ")}` : "", at }));
  const overall = (j.groundedness * 2 + j.completeness + j.actionability + j.clarity) / 50;
  scores.push({ runId, scorer: "judge", dimension: "overall", score: overall, note: j.critique, at });
  if (expectations.length) {
    const met = j.expectations.filter((e) => e.met).length;
    scores.push({ runId, scorer: "judge", dimension: "expectations", score: expectations.length ? met / expectations.length : 0, note: j.expectations.map((e) => `${e.met ? "✓" : "✗"} ${e.expectation} — ${e.why}`).join("\n"), at });
  }
  for (const s of scores) upsertScore(db, s);
  return scores;
};

// ---- benchmark --------------------------------------------------------------

export const benchmarkCases = (agentId?: string): EvalCase[] => EVAL_CASES.filter((c) => !agentId || c.agentId === agentId);

/** Run every case (optionally one agent's, optionally on another model), judge each, and return the runs. Sequential: the model is the bottleneck. */
export const runBenchmark = async (db: Database, llm: Llm, now: Date, agentId?: string, onProgress?: (done: number, total: number) => void, model?: string): Promise<AgentRun[]> => {
  const cases = benchmarkCases(agentId);
  const out: AgentRun[] = [];
  onProgress?.(0, cases.length);
  for (const [i, c] of cases.entries()) {
    const st = loadState(db, now);
    if (!st.projects.some((p) => p.id === c.proj)) continue;
    const agent = st.agents.find((a) => a.id === c.agentId);
    if (!agent) continue;
    const run =
      agent.kind === "curator"
        ? await curateGlance(db, llm, model ? { ...agent, model } : agent, new Date(), { benchmark: c.id })
        : await runAgent(db, llm, { agentId: c.agentId, proj: c.proj, instruction: c.instruction }, new Date(), { benchmark: c.id, ...(model ? { model } : {}) });
    if (run.state !== "failed") await judgeRun(db, llm, run.id, new Date()).catch(() => []);
    out.push(run);
    onProgress?.(i + 1, cases.length);
  }
  return out;
};
