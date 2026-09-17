// ================= agent economics =================
//
// What the agents cost and what came of it, side by side. Spend is derived
// from runs (tokens, and dollars when the model is priced); outcomes are the
// proposals those runs staged and what people decided about them. Nothing
// here is stored; the window is the same trailing window the quality tables
// use, so the two pages agree.

import { RUN_WINDOW_DAYS } from "./agents.ts";
import { runCost, runTokens } from "./spend.ts";
import type { PriceList } from "./spend.ts";
import type { Agent, AgentRun, AppState, Project, ProjectTemplate, Proposal } from "./types.ts";

const DAY = 86_400_000;

/** Spend and outcomes for one grouping (an agent, a project, a template). */
export interface EconomicsLine {
  id: string;
  name: string;
  runs: number;
  failed: number;
  tokens: number;
  /** USD across priced runs, or null when none of the runs had a price. */
  usd: number | null;
  /** Runs that used tokens but whose model has no price. */
  unpriced: number;
  proposals: number;
  accepted: number;
  dismissed: number;
  pending: number;
  /** accepted / decided, or null before any decision. */
  acceptanceRate: number | null;
  /** USD per accepted proposal, or null without dollars or acceptances. */
  usdPerAccepted: number | null;
  /** Tokens per accepted proposal, or null without acceptances. */
  tokensPerAccepted: number | null;
  /** Share of the window's total spend (dollars when priced, tokens otherwise), 0–1. */
  share: number;
}

export interface Economics {
  /** Trailing window in days. */
  windowDays: number;
  since: string;
  total: EconomicsLine;
  byAgent: EconomicsLine[];
  byProject: EconomicsLine[];
  /** Projects grouped by the template they follow; projects without one fall under "No template". */
  byTemplate: EconomicsLine[];
  /** Whether any run in the window carried a price. */
  priced: boolean;
}

const line = (id: string, name: string, runs: AgentRun[], proposals: Proposal[], prices: PriceList): Omit<EconomicsLine, "share"> => {
  let tokens = 0;
  let usd: number | null = null;
  let unpriced = 0;
  for (const r of runs) {
    const t = runTokens(r);
    tokens += t;
    const c = runCost(r, prices);
    if (c !== null) usd = (usd ?? 0) + c;
    else if (t > 0) unpriced += 1;
  }
  const accepted = proposals.filter((p) => p.state === "accepted").length;
  const dismissed = proposals.filter((p) => p.state === "dismissed").length;
  const decided = accepted + dismissed;
  return {
    id,
    name,
    runs: runs.length,
    failed: runs.filter((r) => r.state === "failed").length,
    tokens,
    usd,
    unpriced,
    proposals: proposals.length,
    accepted,
    dismissed,
    pending: proposals.length - decided,
    acceptanceRate: decided ? accepted / decided : null,
    usdPerAccepted: usd !== null && accepted ? usd / accepted : null,
    tokensPerAccepted: accepted ? tokens / accepted : null,
  };
};

const withShare = (lines: Omit<EconomicsLine, "share">[], total: Omit<EconomicsLine, "share">, priced: boolean): EconomicsLine[] =>
  lines
    .map((l): EconomicsLine => ({ ...l, share: priced ? (total.usd ? (l.usd ?? 0) / total.usd : 0) : total.tokens ? l.tokens / total.tokens : 0 }))
    .sort((a, b) => b.share - a.share || b.runs - a.runs || a.name.localeCompare(b.name));

/**
 * Cost and outcomes over the trailing window, by agent, project, and template.
 * Benchmark runs count toward spend (they cost the same tokens) but never
 * toward proposals. A proposal belongs to the agent that made it and the
 * project it targets; workspace-level proposals have no project.
 */
export const economics = (
  state: Pick<AppState, "agents" | "projects" | "runs" | "proposals"> & Partial<Pick<AppState, "templates">>,
  prices: PriceList,
  asOf: string,
  windowDays = RUN_WINDOW_DAYS,
): Economics => {
  const since = new Date(new Date(asOf).getTime() - windowDays * DAY).toISOString();
  const runs = state.runs.filter((r) => r.startedAt >= since);
  const proposals = state.proposals.filter((p) => p.createdAt >= since);
  const priced = runs.some((r) => runCost(r, prices) !== null);
  const total = line("total", "All agents", runs, proposals, prices);
  const agentName = (a: Agent) => a.name;
  const byAgent = withShare(
    state.agents.map((a) => line(a.id, agentName(a), runs.filter((r) => r.agentId === a.id), proposals.filter((p) => p.agentId === a.id), prices)),
    total,
    priced,
  ).filter((l) => l.runs > 0 || l.proposals > 0);
  const projectLine = (p: Project) => line(p.id, p.name, runs.filter((r) => r.proj === p.id), proposals.filter((x) => x.proj === p.id), prices);
  const workspace = line("", "Workspace-wide", runs.filter((r) => r.proj === null), proposals.filter((p) => p.proj === null), prices);
  const byProject = withShare([...state.projects.map(projectLine), workspace], total, priced).filter((l) => l.runs > 0 || l.proposals > 0);
  const templateOf = (p: Project): ProjectTemplate | undefined => (p.template ? state.templates?.find((t) => t.id === p.template?.id) : undefined);
  const groups = new Map<string, { name: string; projects: Project[] }>();
  for (const p of state.projects) {
    const t = templateOf(p);
    const key = t?.id ?? "";
    const g = groups.get(key) ?? { name: t?.name ?? "No template", projects: [] };
    g.projects.push(p);
    groups.set(key, g);
  }
  const byTemplate = withShare(
    [...groups.entries()].map(([id, g]) => {
      const ids = new Set(g.projects.map((p) => p.id));
      return line(id, g.name, runs.filter((r) => r.proj !== null && ids.has(r.proj)), proposals.filter((p) => p.proj !== null && ids.has(p.proj)), prices);
    }),
    total,
    priced,
  ).filter((l) => l.runs > 0 || l.proposals > 0);
  return { windowDays, since, total: { ...total, share: 1 }, byAgent, byProject, byTemplate, priced };
};
