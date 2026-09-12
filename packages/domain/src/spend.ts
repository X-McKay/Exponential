// ================= agent spend and budgets =================
//
// Spend is derived from runs: every run records the tokens it used, and a
// price list (USD per million tokens by model) turns tokens into money. A
// budget is a fact: a monthly ceiling for the workspace, an agent, or a
// project. Whether a run may start follows from the two, and nothing here
// is stored.

import type { AgentRun, AppState, Budget, BudgetScope, ModelPrice } from "./types.ts";

export type PriceList = Record<string, ModelPrice>;

/** "model=0.20/0.60,other@https://host/v1=1/4": USD per million tokens in and out. Bad entries are skipped. */
export const parsePrices = (spec: string | undefined): PriceList => {
  const out: PriceList = {};
  for (const entry of (spec ?? "").split(",")) {
    const eq = entry.lastIndexOf("=");
    if (eq <= 0) continue;
    const model = entry.slice(0, eq).trim();
    const [inp, outp] = entry.slice(eq + 1).split("/").map((s) => Number(s.trim()));
    if (!model || inp === undefined || outp === undefined || !Number.isFinite(inp) || !Number.isFinite(outp) || inp < 0 || outp < 0) continue;
    out[model] = { input: inp, output: outp };
  }
  return out;
};

/** The price for a run's model: exact name, or the name before "@endpoint". */
export const priceFor = (model: string | null, prices: PriceList): ModelPrice | null => {
  if (!model) return null;
  const exact = prices[model];
  if (exact) return exact;
  const at = model.indexOf("@");
  return at > 0 ? (prices[model.slice(0, at)] ?? null) : null;
};

export const runTokens = (r: Pick<AgentRun, "promptTokens" | "completionTokens">): number => (r.promptTokens ?? 0) + (r.completionTokens ?? 0);

/** USD a run cost, or null when its model has no price (or it recorded no tokens). */
export const runCost = (r: Pick<AgentRun, "model" | "promptTokens" | "completionTokens">, prices: PriceList): number | null => {
  const p = priceFor(r.model, prices);
  if (!p || runTokens(r) === 0) return null;
  return ((r.promptTokens ?? 0) * p.input + (r.completionTokens ?? 0) * p.output) / 1_000_000;
};

export interface Spend {
  runs: number;
  tokens: number;
  /** USD across priced runs; null when no run in the set had a price. */
  usd: number | null;
  /** Runs that used tokens but whose model has no price. */
  unpriced: number;
}

export const spendOf = (runs: Pick<AgentRun, "model" | "promptTokens" | "completionTokens">[], prices: PriceList): Spend => {
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
  return { runs: runs.length, tokens, usd, unpriced };
};

/** First instant of the month `asOf` falls in (UTC). */
export const monthStart = (asOf: string): string => `${asOf.slice(0, 7)}-01T00:00:00.000Z`;

/** Runs that count toward this month's spend for a scope: the workspace, one agent, or one project (a project's runs include workspace-wide ones only for the workspace scope). */
export const runsInScope = (runs: AgentRun[], scope: BudgetScope, ref: string, asOf: string): AgentRun[] => {
  const since = monthStart(asOf);
  return runs.filter((r) => r.startedAt >= since && (scope === "workspace" || (scope === "agent" ? r.agentId === ref : r.proj === ref)));
};

export type BudgetState = "none" | "ok" | "warn" | "over";
export const BUDGET_WARN_AT = 0.8;

export interface BudgetLine {
  scope: BudgetScope;
  ref: string;
  budget: Budget | null;
  spend: Spend;
  /** Share of the tighter ceiling used, or null without a budget. */
  used: number | null;
  state: BudgetState;
  /** Which ceiling `used` measures. */
  against: "usd" | "tokens" | null;
}

/** How a scope stands against its budget this month. */
export const budgetLine = (state: Pick<AppState, "runs" | "budgets" | "asOf">, prices: PriceList, scope: BudgetScope, ref: string): BudgetLine => {
  const budget = state.budgets.find((b) => b.scope === scope && b.ref === ref) ?? null;
  const spend = spendOf(runsInScope(state.runs, scope, ref, state.asOf), prices);
  let used: number | null = null;
  let against: BudgetLine["against"] = null;
  if (budget) {
    const byUsd = budget.monthlyUsd !== null && budget.monthlyUsd > 0 ? (spend.usd ?? 0) / budget.monthlyUsd : null;
    const byTokens = budget.monthlyTokens !== null && budget.monthlyTokens > 0 ? spend.tokens / budget.monthlyTokens : null;
    if (byUsd !== null && (byTokens === null || byUsd >= byTokens)) {
      used = byUsd;
      against = "usd";
    } else if (byTokens !== null) {
      used = byTokens;
      against = "tokens";
    }
  }
  const st: BudgetState = used === null ? "none" : used >= 1 ? "over" : used >= BUDGET_WARN_AT ? "warn" : "ok";
  return { scope, ref, budget, spend, used, state: st, against };
};

/** Every budget line that applies to a run: the workspace, the agent, and the project when there is one. */
export const budgetLinesFor = (state: Pick<AppState, "runs" | "budgets" | "asOf">, prices: PriceList, agentId: string, proj: string | null): BudgetLine[] => [
  budgetLine(state, prices, "workspace", ""),
  budgetLine(state, prices, "agent", agentId),
  ...(proj ? [budgetLine(state, prices, "project", proj)] : []),
];

export const fmtUsd = (v: number): string => (v >= 100 ? `$${Math.round(v)}` : v >= 10 ? `$${v.toFixed(1)}` : `$${v.toFixed(2)}`);
export const fmtTokens = (n: number): string => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

/** The ceiling in words: "$50", "2.0M tokens", or both. */
export const budgetLabel = (b: Pick<Budget, "monthlyUsd" | "monthlyTokens">): string => [b.monthlyUsd !== null ? fmtUsd(b.monthlyUsd) : null, b.monthlyTokens !== null ? `${fmtTokens(b.monthlyTokens)} tokens` : null].filter(Boolean).join(" or ") || "no ceiling";

/** Why a run may not start now, or null when every applicable budget has room. */
export const overBudget = (state: Pick<AppState, "runs" | "budgets" | "asOf" | "agents" | "projects">, prices: PriceList, agentId: string, proj: string | null): string | null => {
  for (const line of budgetLinesFor(state, prices, agentId, proj)) {
    if (line.state !== "over" || !line.budget) continue;
    const name = line.scope === "workspace" ? "the workspace" : line.scope === "agent" ? (state.agents.find((a) => a.id === line.ref)?.name ?? line.ref) : (state.projects.find((p) => p.id === line.ref)?.name ?? line.ref);
    const spent = line.against === "usd" ? fmtUsd(line.spend.usd ?? 0) : `${fmtTokens(line.spend.tokens)} tokens`;
    return `${name} has used ${spent} of its ${budgetLabel(line.budget)} monthly budget; raise the budget on the Agents page or wait for next month`;
  }
  return null;
};
