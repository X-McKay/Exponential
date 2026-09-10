// ================= agents (derived) =================
//
// An agent is a definition: what it does, which model it uses, whether it
// runs on a schedule. A run is a fact: when it ran, against which project,
// what it produced. Status, run counts, success rates, and "last run" are
// derived from runs and the clock, never stored.

import type { Agent, AgentRun, AgentStatus, RunState } from "./types.ts";

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
    attention: recent.filter((r) => r.state === "attention").length,
  };
};

/** Runs flagged for attention in the window, newest first, across every agent. */
export const attentionRuns = (runs: AgentRun[], asOf: string): AgentRun[] => {
  const since = new Date(new Date(asOf).getTime() - RUN_WINDOW_DAYS * DAY).toISOString();
  return runs.filter((r) => r.state === "attention" && r.startedAt >= since).sort((a, b) => (b.startedAt < a.startedAt ? -1 : 1));
};

/** Whether a scheduled agent is due: nightly means no run started in the last 20 hours. */
export const isDue = (agent: Agent, runs: AgentRun[], now: string): boolean => {
  if (!agent.schedule) return false;
  const last = runsOf(agent, runs)[0];
  if (!last) return true;
  return new Date(now).getTime() - new Date(last.startedAt).getTime() > 20 * 3_600_000;
};

export const RUN_STATE_ICON: Record<RunState, string> = { queued: "◌", working: "◌", done: "✓", attention: "!", failed: "✗" };

/** Next run id: run-<n>. */
export const nextRunId = (runs: Pick<AgentRun, "id">[]): string => {
  const nums = runs.map((r) => parseInt((r.id.match(/\d+/) ?? ["0"])[0] ?? "0", 10));
  return `run-${Math.max(0, ...nums) + 1}`;
};
