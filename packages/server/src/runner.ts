// ================= dispatcher =================
//
// One entry point for "run this agent", whatever its kind, used by the API
// route and the scheduler. Project-scoped kinds need a project; the brief,
// tuner, and scout work over the whole workspace.

import type { Database } from "bun:sqlite";
import { isDue, overBudget } from "@valueflow/domain";
import type { AgentRun } from "@valueflow/domain";
import type { RunAgentInput } from "@valueflow/shared";
import { runAgent, rulesFor } from "./agents.ts";
import { runBrief } from "./brief.ts";
import type { BriefDelivery } from "./brief.ts";
import { curateGlance } from "./curator.ts";
import type { Llm } from "./llm.ts";
import { NotFound, loadState } from "./repo.ts";
import { scoutModels } from "./scout.ts";
import { TUNER_MIN_RUNS, tunable, tuneAgent } from "./tuner.ts";

export interface RunnerOptions {
  deliverBrief?: BriefDelivery | null;
}

/** Run an agent of any kind; returns one run per piece of work done. */
export const runAny = async (db: Database, llm: Llm, input: RunAgentInput, now: Date, options: RunnerOptions = {}): Promise<AgentRun[]> => {
  const state = loadState(db, now);
  const agent = state.agents.find((a) => a.id === input.agentId);
  if (!agent) throw new NotFound(`agent ${input.agentId} not found`);
  switch (agent.kind) {
    case "deck":
    case "comms":
    case "ideation":
    case "audit":
    case "chat":
    case "rules":
      return [await runAgent(db, llm, input, now)];
    case "brief":
      return [await runBrief(db, llm, agent, now, { deliver: options.deliverBrief ?? null })];
    case "tuner": {
      const targets = input.target ? [input.target] : tunable(state).map((a) => a.id);
      const out: AgentRun[] = [];
      for (const t of targets) out.push(await tuneAgent(db, llm, agent, t, now));
      return out;
    }
    case "scout":
      return [await scoutModels(db, llm, agent, now, { agentId: input.target })];
    case "curator":
      return [await curateGlance(db, llm, agent, now)];
  }
};

/** Which scheduled runs were held back this tick and why, for the log. */
export interface Skipped {
  agentId: string;
  proj: string | null;
  reason: string;
}

/**
 * Run every scheduled agent that is due. Project kinds run once per project;
 * the rest once. A run whose workspace, agent, or project budget is used up
 * is skipped (reported in `skipped`), before work starts. Provider calls also reserve estimated capacity.
 */
export const runDue = async (db: Database, llm: Llm, now: Date, options: RunnerOptions = {}, skipped: Skipped[] = []): Promise<AgentRun[]> => {
  const state = loadState(db, now);
  const out: AgentRun[] = [];
  const prices = llm.describe().prices;
  /** Budgets are checked against the runs so far, including this tick's, with provider-call checks handling nested calls and reservations. */
  const allowed = (agentId: string, proj: string | null): boolean => {
    const reason = overBudget(loadState(db, now), prices, agentId, proj);
    if (reason) skipped.push({ agentId, proj, reason });
    return reason === null;
  };
  for (const agent of state.agents) {
    if (!isDue(agent, state.runs, now.toISOString())) continue;
    switch (agent.kind) {
      case "chat":
        continue;
      case "deck":
      case "comms":
      case "ideation":
      case "audit":
        for (const p of state.projects) if (allowed(agent.id, p.id)) out.push(await runAgent(db, llm, { agentId: agent.id, proj: p.id }, now));
        break;
      case "rules":
        for (const p of state.projects) if (rulesFor(state, p).length && allowed(agent.id, p.id)) out.push(await runAgent(db, llm, { agentId: agent.id, proj: p.id }, now));
        break;
      case "brief":
        if (allowed(agent.id, null)) out.push(await runBrief(db, llm, agent, now, { deliver: options.deliverBrief ?? null }));
        break;
      case "tuner": {
        // Only agents with enough measured runs; the tuner says so itself otherwise, and that would be weekly noise.
        const eligible = tunable(state).filter((t) => state.runs.filter((r) => r.agentId === t.id && (r.state === "done" || r.state === "attention" || r.state === "failed")).length >= TUNER_MIN_RUNS);
        for (const t of eligible) if (allowed(agent.id, null)) out.push(await tuneAgent(db, llm, agent, t.id, now));
        break;
      }
      case "scout":
        if (llm.describe().models.length >= 2 && allowed(agent.id, null)) out.push(await scoutModels(db, llm, agent, now, {}));
        break;
      case "curator":
        // The workspace brief, then one per project, so every overview opens with today's note.
        if (allowed(agent.id, null)) out.push(await curateGlance(db, llm, agent, now));
        for (const p of state.projects) if (allowed(agent.id, p.id)) out.push(await curateGlance(db, llm, agent, now, { proj: p.id }));
        break;
    }
  }
  return out;
};
