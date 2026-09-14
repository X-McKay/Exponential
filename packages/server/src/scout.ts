import { nextStoredRunId, nextStoredProposalId } from "./ids.ts";
import { registerProposalGuard } from "./proposal-guard.ts";
// ================= model scout =================
//
// Same cases, same judge, different model. The scout runs each agent's
// benchmark on every candidate model (LLM_MODELS), makes sure the current
// model has a batch under the current prompt version to compare against, and
// proposes a switch only when the numbers justify it. The comparison itself
// needs no model call: it is arithmetic over stored runs and scores.

import type { Database } from "bun:sqlite";
import { EVAL_CASES, PROJECT_KINDS, fmtUsd, modelComparison } from "@valueflow/domain";
import type { Agent, AgentRun, ModelRow, Proposal } from "@valueflow/domain";
import { runBenchmark } from "./evals.ts";
import type { Llm } from "./llm.ts";
import { trace } from "./live.ts";
import { promptVersion } from "./prompts.ts";
import { insertProposal, insertRun, loadState, updateRun } from "./repo.ts";

export interface ScoutOptions {
  agentId?: string | undefined;
  /** Candidate models; defaults to every model the LLM client lists. */
  models?: string[] | undefined;
  onProgress?: ((done: number, total: number) => void) | undefined;
}

/** Better by a clear margin, or as good and clearly faster or cheaper. */
export const SCOUT_MIN_GAIN = 0.05;
export const SCOUT_TIE = 0.03;
export const SCOUT_LATENCY_RATIO = 0.7;
export const SCOUT_COST_RATIO = 0.7;

export interface Verdict {
  agent: Agent;
  current: string;
  rows: ModelRow[];
  recommend: ModelRow | null;
  reason: string;
}

/** Decide from a comparison table whether a candidate earns a proposal. */
export const verdict = (agent: Agent, current: string, rows: ModelRow[]): Omit<Verdict, "agent"> & { agent: Agent } => {
  const cur = rows.find((r) => r.model === current);
  const others = rows.filter((r) => r.model !== current && r.n >= 1 && r.overall !== null);
  if (!cur || cur.overall === null) return { agent, current, rows, recommend: null, reason: "no judged benchmark for the current model" };
  let best: ModelRow | null = null;
  let reason = "no candidate beat the current model";
  for (const c of others) {
    const gain = (c.overall ?? 0) - cur.overall;
    const faster = c.latencyMedianMs !== null && cur.latencyMedianMs !== null && c.latencyMedianMs <= cur.latencyMedianMs * SCOUT_LATENCY_RATIO;
    const cheaper = c.costMean !== null && cur.costMean !== null && cur.costMean > 0 && c.costMean <= cur.costMean * SCOUT_COST_RATIO;
    const failsMore = c.failed > cur.failed;
    if (failsMore) continue;
    if (gain >= SCOUT_MIN_GAIN && (best === null || (c.overall ?? 0) > (best.overall ?? 0))) {
      best = c;
      reason = `judge overall ${Math.round((c.overall ?? 0) * 100)}% vs ${Math.round(cur.overall * 100)}% on the same ${c.n} cases`;
    } else if (best === null && Math.abs(gain) <= SCOUT_TIE && cheaper) {
      best = c;
      reason = `same quality (${Math.round((c.overall ?? 0) * 100)}% vs ${Math.round(cur.overall * 100)}%) at ${fmtUsd(c.costMean ?? 0)} instead of ${fmtUsd(cur.costMean ?? 0)} per run`;
    } else if (best === null && Math.abs(gain) <= SCOUT_TIE && faster) {
      best = c;
      reason = `same quality (${Math.round((c.overall ?? 0) * 100)}% vs ${Math.round(cur.overall * 100)}%) at ${Math.round(((cur.latencyMedianMs ?? 0) - (c.latencyMedianMs ?? 0)) / 1000)}s less median latency`;
    }
  }
  return { agent, current, rows, recommend: best, reason };
};

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
const secs = (v: number | null) => (v === null ? "—" : `${(v / 1000).toFixed(0)}s`);

const table = (v: Verdict): string =>
  [
    `## ${v.agent.name} (current: ${v.current}, prompt ${promptVersion(v.agent.kind, v.agent.prompt, v.agent.id)})`,
    "| model | cases | judge | expectations | grounding | latency | tokens | cost/run | failed |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...v.rows.map((r) => `| ${r.model}${r.model === v.current ? " (current)" : ""} | ${r.n} | ${pct(r.overall)} | ${pct(r.expectations)} | ${pct(r.grounding)} | ${secs(r.latencyMedianMs)} | ${r.tokensMean === null ? "—" : Math.round(r.tokensMean)} | ${r.costMean === null ? "—" : fmtUsd(r.costMean)} | ${r.failed} |`),
    v.recommend ? `**Recommend switching to ${v.recommend.model}**: ${v.reason}.` : `No switch: ${v.reason}.`,
  ].join("\n");

/** Run the comparison for every eligible agent (or one) and record a scout run with proposals. */
export const scoutModels = async (db: Database, llm: Llm, scout: Agent, now: Date, options: ScoutOptions = {}): Promise<AgentRun> => {
  const state0 = loadState(db, now);
  const candidates = [...new Set((options.models ?? llm.describe().models).map((m) => m.trim()).filter(Boolean))];
  const defaultModel = llm.describe().model ?? (await llm.model());
  const prices = llm.describe().prices;
  const targets = state0.agents.filter((a) => PROJECT_KINDS.includes(a.kind) && EVAL_CASES.some((c) => c.agentId === a.id) && (!options.agentId || a.id === options.agentId));
  const started = Date.now();
  const run: AgentRun = {
    id: nextStoredRunId(db),
    agentId: scout.id,
    proj: null,
    tab: "overview",
    state: "working",
    startedAt: now.toISOString(),
    finishedAt: null,
    instruction: options.agentId ? `Scout models for ${targets[0]?.name ?? options.agentId}` : "Scout models for every benchmarked agent",
    summary: `${scout.name} is benchmarking ${candidates.length} model${candidates.length === 1 ? "" : "s"}…`,
    output: "",
    model: null,
    error: null,
    promptVersion: null,
    latencyMs: null,
    promptTokens: null,
    completionTokens: null,
    benchmark: null,
    rating: null,
    ratingNote: null,
  };
  insertRun(db, run, `candidates: ${candidates.join(", ")}`);
  const t = trace(db, run);
  t.step("briefing", `${candidates.length} candidate model${candidates.length === 1 ? "" : "s"}, ${targets.length} agent${targets.length === 1 ? "" : "s"} with benchmark cases`);
  if (candidates.length < 2) {
    const done: AgentRun = { ...run, state: "done", finishedAt: new Date().toISOString(), summary: "Only one model is available; nothing to compare", output: `The endpoint offers ${candidates[0] ?? "no model"}. Add candidates with LLM_MODELS (comma-separated; use name@https://host/v1 for a second endpoint) and the scout will benchmark them against the current model.`, latencyMs: Date.now() - started };
    updateRun(db, done);
    t.step("done", "only one model available; nothing to compare");
    t.finished("done");
    return done;
  }
  try {
    // Every (agent, model) pair that lacks a judged batch under the current prompt version gets one now.
    const jobs: { agent: Agent; model: string }[] = [];
    for (const a of targets) {
      const version = promptVersion(a.kind, a.prompt, a.id);
      const have = new Set(modelComparison(a, state0.runs, state0.scores, version, prices).filter((r) => r.overall !== null).map((r) => r.model));
      const current = a.model ?? defaultModel;
      for (const m of [current, ...candidates]) if (!have.has(m) && !jobs.some((j) => j.agent.id === a.id && j.model === m)) jobs.push({ agent: a, model: m });
    }
    let done = 0;
    options.onProgress?.(0, jobs.length);
    t.step("request", `${jobs.length} benchmark batch${jobs.length === 1 ? "" : "es"} to run: ${jobs.map((j) => `${j.agent.name} on ${j.model}`).join(", ") || "none, all measured already"}`);
    for (const job of jobs) {
      await runBenchmark(db, llm, now, job.agent.id, undefined, job.model);
      done += 1;
      options.onProgress?.(done, jobs.length);
      t.step("reply", `${job.agent.name} on ${job.model} benchmarked (${done} of ${jobs.length})`);
    }
    const state = loadState(db, now);
    const verdicts: Verdict[] = targets.map((a) => {
      const fresh = state.agents.find((x) => x.id === a.id) ?? a;
      return verdict(fresh, fresh.model ?? defaultModel, modelComparison(fresh, state.runs, state.scores, promptVersion(fresh.kind, fresh.prompt, fresh.id), prices));
    });
    const switches = verdicts.filter((v) => v.recommend);
    const finished: AgentRun = {
      ...run,
      state: "done",
      finishedAt: new Date().toISOString(),
      summary: switches.length ? `${switches.length} model switch${switches.length === 1 ? "" : "es"} worth taking: ${switches.map((v) => `${v.agent.name} → ${v.recommend?.model}`).join(", ")}` : `Compared ${candidates.length} models on ${targets.length} agents; the current model holds`,
      output: `Candidates: ${candidates.join(", ")}. Judge: ${llm.describe().judgeModel ?? defaultModel}. Same cases, same judge; a candidate needs +${Math.round(SCOUT_MIN_GAIN * 100)} points, or equal quality at ≤${Math.round(SCOUT_COST_RATIO * 100)}% of the cost per run or ≤${Math.round(SCOUT_LATENCY_RATIO * 100)}% of the latency, to be proposed.\n\n${verdicts.map(table).join("\n\n")}`,
      latencyMs: Date.now() - started,
    };
    updateRun(db, finished);
    t.step("parsed", finished.summary);
    for (const v of switches) {
      const model = v.recommend?.model ?? "";
      const proposal: Proposal = { id: nextStoredProposalId(db), runId: run.id, agentId: scout.id, proj: null, ruleId: null, action: { type: "agent_model", agentId: v.agent.id, model: model === defaultModel ? null : model }, rationale: `${v.reason}.`, state: "pending", createdAt: now.toISOString(), decidedAt: null };
      db.transaction(() => {
        insertProposal(db, proposal);
        registerProposalGuard(db, proposal, state0);
      })();
    }
    t.step("proposals", switches.length ? `${switches.length} model switch${switches.length === 1 ? "" : "es"} proposed` : "no switch justified");
    t.step("done", `compared in ${((finished.latencyMs ?? 0) / 1000).toFixed(0)}s`);
    t.finished("done");
    return finished;
  } catch (e) {
    const failed: AgentRun = { ...run, state: "failed", finishedAt: new Date().toISOString(), summary: `${scout.name} could not finish the comparison`, error: e instanceof Error ? e.message : String(e), latencyMs: Date.now() - started };
    updateRun(db, failed);
    t.step("failed", failed.error ?? "unknown error");
    t.finished("failed");
    return failed;
  }
};
