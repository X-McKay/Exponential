// ================= agents (derived) =================
//
// An agent is a definition: what it does, which model it uses, whether it
// runs on a schedule. A run is a fact: when it ran, against which project,
// what it produced. Status, run counts, success rates, and "last run" are
// derived from runs and the clock, never stored.

import type { Agent, AgentRun, AgentStatus, PromptVersion, Proposal, RunScore, RunState } from "./types.ts";

const DAY = 86_400_000;

export const RUN_WINDOW_DAYS = 30;

export interface AgentStats {
  status: AgentStatus;
  runs: number;
  /** Share of finished runs that did not fail, 0–100, or null with no finished runs. */
  success: number | null;
  /** ISO timestamp of the most recent run, or null. */
  last: string | null;
  attention: number;
}

const finished = (r: AgentRun): boolean => r.state === "done" || r.state === "attention" || r.state === "failed";

export const runsOf = (agent: Pick<Agent, "id">, runs: AgentRun[]): AgentRun[] =>
  runs.filter((r) => r.agentId === agent.id).sort((a, b) => (b.startedAt < a.startedAt ? -1 : b.startedAt > a.startedAt ? 1 : 0));

export const agentStats = (agent: Agent, runs: AgentRun[], asOf: string): AgentStats => {
  const mine = runsOf(agent, runs);
  const since = new Date(new Date(asOf).getTime() - RUN_WINDOW_DAYS * DAY).toISOString();
  const recent = mine.filter((r) => r.startedAt >= since);
  const done = recent.filter(finished);
  const working = mine.some((r) => r.state === "working" || r.state === "queued");
  return {
    status: working ? "working" : agent.schedule ? "scheduled" : "idle",
    runs: recent.length,
    success: done.length ? Math.round((100 * done.filter((r) => r.state !== "failed").length) / done.length) : null,
    last: mine[0]?.startedAt ?? null,
    attention: recent.filter((r) => r.state === "attention" && r.benchmark === null).length,
  };
};

/** Runs flagged for attention in the window, newest first, across every agent. Benchmark runs measure; they do not flag. */
export const attentionRuns = (runs: AgentRun[], asOf: string): AgentRun[] => {
  const since = new Date(new Date(asOf).getTime() - RUN_WINDOW_DAYS * DAY).toISOString();
  return runs.filter((r) => r.state === "attention" && r.benchmark === null && r.startedAt >= since).sort((a, b) => (b.startedAt < a.startedAt ? -1 : 1));
};

/** Most recent Monday 00:00 UTC at or before the instant. */
export const weekStart = (now: string): string => {
  const d = new Date(now);
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back)).toISOString();
};

/** Whether a scheduled agent is due: nightly means no run in the last 20 hours; weekly means none since Monday. */
export const isDue = (agent: Agent, runs: AgentRun[], now: string): boolean => {
  if (!agent.schedule) return false;
  const last = runsOf(agent, runs)[0];
  if (!last) return true;
  switch (agent.schedule) {
    case "nightly":
      return new Date(now).getTime() - new Date(last.startedAt).getTime() > 20 * 3_600_000;
    case "weekly":
      return last.startedAt < weekStart(now);
  }
};

/** The newest finished run of a kind in the trailing days, for the "your week" card and the Ask briefing. */
export const latestRunOfKind = (kind: Agent["kind"], agents: Agent[], runs: AgentRun[], asOf: string, days = 7): AgentRun | null => {
  const ids = new Set(agents.filter((a) => a.kind === kind).map((a) => a.id));
  const since = new Date(new Date(asOf).getTime() - days * DAY).toISOString();
  return runs.filter((r) => ids.has(r.agentId) && (r.state === "done" || r.state === "attention") && r.startedAt >= since).sort((a, b) => (b.startedAt < a.startedAt ? -1 : 1))[0] ?? null;
};

export const RUN_STATE_ICON: Record<RunState, string> = { queued: "◌", working: "◌", done: "✓", attention: "!", failed: "✗" };

/** Next run id: run-<n>. */
export const nextRunId = (runs: Pick<AgentRun, "id">[]): string => {
  const nums = runs.map((r) => parseInt((r.id.match(/\d+/) ?? ["0"])[0] ?? "0", 10));
  return `run-${Math.max(0, ...nums) + 1}`;
};

// ---- scorecards -----------------------------------------------------------

export const JUDGE_DIMENSIONS = ["groundedness", "completeness", "actionability", "clarity"] as const;
export type JudgeDimension = (typeof JUDGE_DIMENSIONS)[number];

export interface BenchmarkBatch {
  /** Day the batch ran. */
  day: string;
  promptVersion: string | null;
  model: string | null;
  n: number;
  /** Mean judge overall, 0–1, or null when unjudged. */
  overall: number | null;
  /** Mean share of expectations met, 0–1, or null. */
  expectations: number | null;
  failed: number;
}

export interface AgentScorecard {
  /** Non-benchmark runs in the window. */
  runs: number;
  failed: number;
  latencyMedianMs: number | null;
  tokensMean: number | null;
  rules: { format: number | null; grounding: number | null; proposalsValid: number | null };
  judge: Record<JudgeDimension, number | null> & { overall: number | null; judged: number };
  ratings: { up: number; down: number };
  proposals: { total: number; accepted: number; dismissed: number; acceptanceRate: number | null };
  /** Newest first. */
  benchmarks: BenchmarkBatch[];
}

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const medianOf = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] ?? null) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
};

const scoreOf = (scores: RunScore[], runIds: Set<string>, scorer: RunScore["scorer"], dimension: string): number | null =>
  mean(scores.filter((s) => runIds.has(s.runId) && s.scorer === scorer && s.dimension === dimension).map((s) => s.score));

/** Everything measurable about an agent's recent work; nothing here is stored. */
export const agentScorecard = (agent: Pick<Agent, "id">, runs: AgentRun[], scores: RunScore[], proposals: Proposal[], asOf: string): AgentScorecard => {
  const since = new Date(new Date(asOf).getTime() - RUN_WINDOW_DAYS * DAY).toISOString();
  const mine = runs.filter((r) => r.agentId === agent.id && r.startedAt >= since);
  const live = mine.filter((r) => r.benchmark === null);
  const liveIds = new Set(live.map((r) => r.id));
  const finishedLive = live.filter(finished);
  const judged = new Set(scores.filter((s) => liveIds.has(s.runId) && s.scorer === "judge" && s.dimension === "overall").map((s) => s.runId));
  const mineProposals = proposals.filter((p) => p.agentId === agent.id && p.createdAt >= since);
  const decided = mineProposals.filter((p) => p.state !== "pending");
  const judge = Object.fromEntries(JUDGE_DIMENSIONS.map((d) => [d, scoreOf(scores, liveIds, "judge", d)])) as Record<JudgeDimension, number | null>;

  const batches = new Map<string, AgentRun[]>();
  for (const r of mine.filter((x) => x.benchmark !== null)) {
    const key = `${r.startedAt.slice(0, 10)}|${r.promptVersion ?? ""}|${r.model ?? ""}`;
    batches.set(key, [...(batches.get(key) ?? []), r]);
  }
  const benchmarks: BenchmarkBatch[] = [...batches.entries()]
    .map(([key, rs]) => {
      const ids = new Set(rs.map((r) => r.id));
      const [day, promptVersion, model] = key.split("|");
      return {
        day: day ?? "",
        promptVersion: promptVersion || null,
        model: model || null,
        n: rs.length,
        overall: scoreOf(scores, ids, "judge", "overall"),
        expectations: scoreOf(scores, ids, "judge", "expectations"),
        failed: rs.filter((r) => r.state === "failed").length,
      };
    })
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));

  return {
    runs: live.length,
    failed: live.filter((r) => r.state === "failed").length,
    latencyMedianMs: medianOf(finishedLive.map((r) => r.latencyMs).filter((x): x is number => x !== null)),
    tokensMean: mean(finishedLive.map((r) => (r.promptTokens ?? 0) + (r.completionTokens ?? 0)).filter((x) => x > 0)),
    rules: {
      format: scoreOf(scores, liveIds, "rules", "format"),
      grounding: scoreOf(scores, liveIds, "rules", "grounding"),
      proposalsValid: scoreOf(scores, liveIds, "rules", "proposals_valid"),
    },
    judge: { ...judge, overall: scoreOf(scores, liveIds, "judge", "overall"), judged: judged.size },
    ratings: { up: live.filter((r) => r.rating === 1).length, down: live.filter((r) => r.rating === -1).length },
    proposals: {
      total: mineProposals.length,
      accepted: decided.filter((p) => p.state === "accepted").length,
      dismissed: decided.filter((p) => p.state === "dismissed").length,
      acceptanceRate: decided.length ? decided.filter((p) => p.state === "accepted").length / decided.length : null,
    },
    benchmarks,
  };
};

// ---- prompt versions & models ------------------------------------------------

export interface PromptHistoryRow {
  version: string;
  /** The extra instructions in force, null for the built-in prompt alone, undefined when unknown (set in code before versions were recorded). */
  prompt: string | null | undefined;
  source: PromptVersion["source"] | "builtin";
  since: string | null;
  current: boolean;
  runs: number;
  failed: number;
  grounding: number | null;
  judge: number | null;
  up: number;
  down: number;
  /** Benchmark runs under this version. */
  benchmark: { n: number; failed: number; overall: number | null; expectations: number | null };
}

/** Every prompt version an agent has run under, newest first, with what the runs under it measured. */
export const promptHistory = (agent: Pick<Agent, "id">, currentVersion: string | null, runs: AgentRun[], scores: RunScore[], versions: PromptVersion[]): PromptHistoryRow[] => {
  const mine = runs.filter((r) => r.agentId === agent.id && r.promptVersion !== null);
  const recorded = versions.filter((v) => v.agentId === agent.id);
  const seen = new Set<string>([...mine.map((r) => r.promptVersion ?? ""), ...recorded.map((v) => v.version), ...(currentVersion ? [currentVersion] : [])]);
  seen.delete("");
  return [...seen]
    .map((version): PromptHistoryRow => {
      const rs = mine.filter((r) => r.promptVersion === version);
      const live = rs.filter((r) => r.benchmark === null);
      const liveIds = new Set(live.map((r) => r.id));
      const bench = rs.filter((r) => r.benchmark !== null);
      const benchIds = new Set(bench.map((r) => r.id));
      const rec = recorded.filter((v) => v.version === version).sort((a, b) => (a.at < b.at ? -1 : 1))[0];
      return {
        version,
        prompt: rec ? rec.prompt : version === currentVersion && !rec ? null : undefined,
        source: rec?.source ?? "builtin",
        since: rec?.at ?? rs.map((r) => r.startedAt).sort()[0] ?? null,
        current: version === currentVersion,
        runs: live.length,
        failed: live.filter((r) => r.state === "failed").length,
        grounding: scoreOf(scores, liveIds, "rules", "grounding"),
        judge: scoreOf(scores, liveIds, "judge", "overall"),
        up: live.filter((r) => r.rating === 1).length,
        down: live.filter((r) => r.rating === -1).length,
        benchmark: { n: benchIds.size, failed: bench.filter((r) => r.state === "failed").length, overall: scoreOf(scores, benchIds, "judge", "overall"), expectations: scoreOf(scores, benchIds, "judge", "expectations") },
      };
    })
    .sort((a, b) => (a.current ? -1 : b.current ? 1 : (b.since ?? "") < (a.since ?? "") ? -1 : 1));
};

export interface ModelRow {
  model: string;
  n: number;
  failed: number;
  overall: number | null;
  expectations: number | null;
  grounding: number | null;
  latencyMedianMs: number | null;
  tokensMean: number | null;
}

/** Benchmark results per model for one agent under one prompt version (or any version when null), best first. */
export const modelComparison = (agent: Pick<Agent, "id">, runs: AgentRun[], scores: RunScore[], promptVersion: string | null): ModelRow[] => {
  const mine = runs.filter((r) => r.agentId === agent.id && r.benchmark !== null && r.model !== null && (promptVersion === null || r.promptVersion === promptVersion));
  const byModel = new Map<string, AgentRun[]>();
  for (const r of mine) byModel.set(r.model ?? "", [...(byModel.get(r.model ?? "") ?? []), r]);
  return [...byModel.entries()]
    .map(([model, rs]): ModelRow => {
      const ids = new Set(rs.map((r) => r.id));
      const ok = rs.filter(finished).filter((r) => r.state !== "failed");
      return {
        model,
        n: rs.length,
        failed: rs.filter((r) => r.state === "failed").length,
        overall: scoreOf(scores, ids, "judge", "overall"),
        expectations: scoreOf(scores, ids, "judge", "expectations"),
        grounding: scoreOf(scores, ids, "rules", "grounding"),
        latencyMedianMs: medianOf(ok.map((r) => r.latencyMs).filter((x): x is number => x !== null)),
        tokensMean: mean(ok.map((r) => (r.promptTokens ?? 0) + (r.completionTokens ?? 0)).filter((x) => x > 0)),
      };
    })
    .sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1) || a.model.localeCompare(b.model));
};

/** Numbers and ids an output cites that do not appear in the briefing it was given. */
export const ungroundedTokens = (output: string, briefing: string): { cited: string[]; missing: string[] } => {
  const norm = (s: string) => s.replace(/,/g, "");
  const tokens = new Set<string>();
  for (const m of norm(output).matchAll(/(?<![\w.-])(MS-\d+|R\d+|PRJ-\d+|\d+(?:\.\d+)?%|\d{2,}(?:\.\d+)?)(?![\w%])/g)) tokens.add(m[1] ?? "");
  const hay = norm(briefing);
  const cited = [...tokens].filter(Boolean);
  const missing = cited.filter((t) => !hay.includes(t.endsWith("%") ? t.slice(0, -1) : t));
  return { cited, missing };
};
