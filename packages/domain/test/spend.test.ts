// Spend derives from runs and prices; budgets are the only fact; a ceiling
// reached means no more runs for that scope this month.

import { describe, expect, test } from "bun:test";
import { budgetLine, overBudget, parsePrices, priceFor, runCost, seedState, spendOf } from "../src/index.ts";
import type { AgentRun, AppState } from "../src/index.ts";

const run = (over: Partial<AgentRun>): AgentRun => ({
  id: "run-x",
  agentId: "audie",
  proj: "clauses",
  tab: "overview",
  state: "done",
  startedAt: "2026-09-05T10:00:00Z",
  finishedAt: "2026-09-05T10:01:00Z",
  instruction: null,
  summary: "",
  output: "",
  model: "qwen",
  error: null,
  promptVersion: null,
  latencyMs: 1000,
  promptTokens: 1_000_000,
  completionTokens: 500_000,
  benchmark: null,
  rating: null,
  ratingNote: null,
  ...over,
});

const PRICES = parsePrices("qwen=0.20/0.60, gpt-5-mini@https://api.openai.com/v1=0.25/2, bad=x/y, =1/2");

describe("prices and cost", () => {
  test("parsePrices reads model=in/out pairs and skips bad entries; endpoints in names are matched with or without them", () => {
    expect(PRICES).toEqual({ qwen: { input: 0.2, output: 0.6 }, "gpt-5-mini@https://api.openai.com/v1": { input: 0.25, output: 2 } });
    expect(priceFor("qwen@https://other/v1", PRICES)).toEqual({ input: 0.2, output: 0.6 });
    expect(priceFor("mystery", PRICES)).toBeNull();
    expect(priceFor(null, PRICES)).toBeNull();
  });

  test("a run costs its tokens at the model's prices; unpriced models cost null but still count tokens", () => {
    expect(runCost(run({}), PRICES)).toBeCloseTo(0.2 + 0.3);
    expect(runCost(run({ model: "mystery" }), PRICES)).toBeNull();
    expect(runCost(run({ promptTokens: null, completionTokens: null }), PRICES)).toBeNull();
    const s = spendOf([run({}), run({ model: "mystery" }), run({ promptTokens: null, completionTokens: null })], PRICES);
    expect(s).toEqual({ runs: 3, tokens: 3_000_000, usd: 0.5, unpriced: 1, unknown: 1 });
    expect(spendOf([run({ model: "mystery" })], {}).usd).toBeNull();
    expect(runCost({ ...run({}), costUsd: 7 }, PRICES)).toBe(7);
  });
});

describe("budgets", () => {
  const base = (): AppState => ({ ...seedState(), asOf: "2026-09-10T09:00:00.000Z", runs: [run({ id: "a" }), run({ id: "b", agentId: "slider", proj: "invoice" }), run({ id: "old", startedAt: "2026-08-30T10:00:00Z" })] });

  test("month-to-date spend per scope ignores last month; the tighter of dollars and tokens is the ceiling", () => {
    const s: AppState = { ...base(), budgets: [{ scope: "workspace", ref: "", monthlyUsd: 2, monthlyTokens: 4_000_000 }, { scope: "agent", ref: "audie", monthlyUsd: null, monthlyTokens: 1_000_000 }] };
    const ws = budgetLine(s, PRICES, "workspace", "");
    expect(ws.spend.runs).toBe(2);
    expect(ws.spend.usd).toBeCloseTo(1);
    // 3.0M of 4M tokens (75%) is tighter than $1 of $2 (50%).
    expect(ws.against).toBe("tokens");
    expect(ws.used).toBeCloseTo(0.75);
    expect(ws.state).toBe("ok");
    const audie = budgetLine(s, PRICES, "agent", "audie");
    expect(audie.spend.runs).toBe(1);
    expect(audie.used).toBeCloseTo(1.5);
    expect(audie.state).toBe("over");
    expect(budgetLine(s, PRICES, "project", "clauses").state).toBe("none");
  });

  test("overBudget names the scope that is out of room, and only that scope's runs are refused", () => {
    const s: AppState = { ...base(), budgets: [{ scope: "agent", ref: "audie", monthlyUsd: 0.4, monthlyTokens: null }, { scope: "project", ref: "invoice", monthlyUsd: null, monthlyTokens: 1_000_000 }] };
    expect(overBudget(s, PRICES, "audie", "search")).toMatch(/^Audie has used \$0\.50 of its \$0\.40 monthly budget/);
    expect(overBudget(s, PRICES, "slider", "invoice")).toMatch(/^Invoice Review Assistant has used 1\.5M tokens of its 1\.0M tokens monthly budget/);
    expect(overBudget(s, PRICES, "slider", "clauses")).toBeNull();
    expect(overBudget(s, PRICES, "comma", null)).toBeNull();
    // Warn from 80%.
    const near: AppState = { ...s, budgets: [{ scope: "workspace", ref: "", monthlyUsd: 1.2, monthlyTokens: null }] };
    expect(budgetLine(near, PRICES, "workspace", "").state).toBe("warn");
    expect(overBudget(near, PRICES, "audie", null)).toBeNull();
  });

  test("zero dollar and token ceilings are enforced as exhausted", () => {
    const s: AppState = { ...base(), budgets: [{ scope: "workspace", ref: "", monthlyUsd: 0, monthlyTokens: null }, { scope: "agent", ref: "audie", monthlyUsd: null, monthlyTokens: 0 }] };
    expect(budgetLine(s, PRICES, "workspace", "")).toMatchObject({ state: "over", against: "usd", used: 1 });
    expect(budgetLine(s, PRICES, "agent", "audie")).toMatchObject({ state: "over", against: "tokens", used: 1 });
    expect(overBudget(s, PRICES, "audie", "clauses")).toMatch(/^the workspace has used \$1\.00 of its \$0\.00 monthly budget/);
  });

  test("uses ledger-backed usage runs when the server supplies them", () => {
    const s = { ...base(), budgets: [{ scope: "workspace" as const, ref: "", monthlyUsd: 1, monthlyTokens: null }], runs: [run({ promptTokens: 10_000_000, completionTokens: 0 })], usageRuns: [{ ...run({ promptTokens: 1, completionTokens: 1 }), costUsd: 0.000001 }] };
    expect(budgetLine(s, PRICES, "workspace", "").spend.tokens).toBe(2);
    expect(budgetLine(s, PRICES, "workspace", "").spend.usd).toBe(0.000001);
  });

  test("holds the applicable ceiling when usage is unknown, while unpriced known tokens remain usable for token budgets", () => {
    const unknown = { ...run({ id: "unknown", promptTokens: null, completionTokens: null }), costUsd: null };
    const s = { ...base(), budgets: [{ scope: "workspace" as const, ref: "", monthlyUsd: 10, monthlyTokens: 10_000_000 }], usageRuns: [unknown] };
    expect(budgetLine(s, PRICES, "workspace", "")).toMatchObject({ state: "over", used: 1 });
    expect(budgetLine(s, PRICES, "workspace", "").spend.unknown).toBe(1);

    const unpriced = run({ id: "unpriced", model: "unknown-model" });
    const tokenOnly = { ...base(), budgets: [{ scope: "workspace" as const, ref: "", monthlyUsd: null, monthlyTokens: 10_000_000 }], usageRuns: [unpriced] };
    expect(budgetLine(tokenOnly, PRICES, "workspace", "").state).toBe("ok");
    expect(budgetLine(tokenOnly, PRICES, "workspace", "").spend.unpriced).toBe(1);
  });
});
