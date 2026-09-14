import { describe, expect, test } from "bun:test";
import type { ChatMessage, Llm } from "../src/llm.ts";
import { callLlm, ensureUsageLedger, loadUsageRuns } from "../src/usage.ts";
import { openDb } from "../src/db.ts";
import { seed } from "../src/seed.ts";

const NOW = new Date("2026-09-12T12:00:00.000Z");
const messages: ChatMessage[] = [{ role: "user", content: "hello" }];

const fake = (usage: { prompt: number; completion: number } | null, prices: Record<string, { input: number; output: number }> = { fake: { input: 1, output: 2 } }): Llm => ({
  model: () => Promise.resolve("fake"),
  chat: () => Promise.resolve({ content: "ok", model: "fake", usage, truncated: false }),
  describe: () => ({ baseUrl: "http://fake", model: "fake", models: ["fake"], judgeModel: null, prices }),
});

const dbWithBudget = (monthlyTokens: number | null, monthlyUsd: number | null) => {
  const db = openDb(":memory:");
  seed(db);
  // Seeded demo runs intentionally have no provider usage. Keep this ledger
  // fixture focused on calls under test, including the explicit working row.
  db.query("DELETE FROM agent_runs").run();
  db.query("DELETE FROM budgets").run();
  db.query("INSERT INTO budgets (scope, ref, monthly_tokens, monthly_usd) VALUES ('workspace', '', ?, ?)").run(monthlyTokens, monthlyUsd);
  ensureUsageLedger(db);
  return db;
};

describe("LLM usage ledger", () => {
  test("records reconciled usage and reserves only the configured output soft cap", async () => {
    const db = dbWithBudget(1_000, null);
    await expect(callLlm(db, fake({ prompt: 100, completion: 50 }), { agentId: "audie", proj: "ima", runId: "run-1" }, messages, { maxTokens: 200 }, NOW)).resolves.toMatchObject({ content: "ok" });
    expect(db.query<{ state: string; prompt_tokens: number; completion_tokens: number; reserved_tokens: number }, []>("SELECT state, prompt_tokens, completion_tokens, reserved_tokens FROM llm_usage_ledger").get()).toEqual({ state: "succeeded", prompt_tokens: 100, completion_tokens: 50, reserved_tokens: 0 });
  });

  test("zero ceilings and insufficient reservations block before calling the provider", async () => {
    const db = dbWithBudget(0, null);
    let called = false;
    const llm = { ...fake({ prompt: 1, completion: 1 }), chat: () => { called = true; return Promise.resolve({ content: "ok", model: "fake", usage: { prompt: 1, completion: 1 }, truncated: false }); } };
    await expect(callLlm(db, llm, { agentId: "audie", proj: null, runId: null }, messages, { maxTokens: 1 }, NOW)).rejects.toThrow("no known token capacity");
    expect(called).toBe(false);
  });

  test("unknown provider usage is held as an unknown ledger row and blocks later budgeted calls", async () => {
    const db = dbWithBudget(1_000, null);
    await expect(callLlm(db, fake(null), { agentId: "audie", proj: null, runId: "run-unknown" }, messages, { maxTokens: 100 }, NOW)).rejects.toThrow("usage or price was unknown");
    expect(db.query<{ state: string }, []>("SELECT state FROM llm_usage_ledger").get()?.state).toBe("unknown");
    await expect(callLlm(db, fake({ prompt: 1, completion: 1 }), { agentId: "audie", proj: null, runId: "run-next" }, messages, { maxTokens: 100 }, NOW)).rejects.toThrow("no known token capacity");
  });

  test("a dollar budget rejects an unpriced model before sending it", async () => {
    const db = dbWithBudget(null, 10);
    let called = false;
    const llm = { ...fake({ prompt: 1, completion: 1 }, {}), chat: () => { called = true; return Promise.resolve({ content: "ok", model: "mystery", usage: { prompt: 1, completion: 1 }, truncated: false }); } };
    await expect(callLlm(db, llm, { agentId: null, proj: null, runId: null }, messages, { maxTokens: 10 }, NOW)).rejects.toThrow("no known cost");
    expect(called).toBe(false);
  });

  test("known usage with an unknown price remains usable for a token-only budget", async () => {
    const db = dbWithBudget(1_000, null);
    const llm = fake({ prompt: 10, completion: 5 }, {});
    await expect(callLlm(db, llm, { agentId: "audie", proj: null, runId: "run-unpriced" }, messages, { maxTokens: 10 }, NOW)).resolves.toMatchObject({ content: "ok" });
    expect(db.query<{ state: string; prompt_tokens: number; cost_usd: number | null }, []>("SELECT state, prompt_tokens, cost_usd FROM llm_usage_ledger").get()).toEqual({ state: "succeeded", prompt_tokens: 10, cost_usd: null });
  });

  test("importing a known unpriced legacy run preserves token accounting", async () => {
    const db = dbWithBudget(1_000, null);
    db.query("INSERT INTO agent_runs (id, agent_id, project_id, tab, state, started_at, finished_at, summary, output, model, prompt_tokens, completion_tokens) VALUES ('legacy-unpriced', 'audie', 'ima', 'overview', 'done', ?, ?, '', '', 'mystery', 10, 5)").run(NOW.toISOString(), NOW.toISOString());
    await callLlm(db, fake({ prompt: 1, completion: 1 }, {}), { agentId: "audie", proj: "ima", runId: "legacy-unpriced" }, messages, { maxTokens: 10 }, NOW);
    expect(db.query<{ state: string; prompt_tokens: number; cost_usd: number | null }, [string]>("SELECT state, prompt_tokens, cost_usd FROM llm_usage_ledger WHERE run_id = ? ORDER BY id LIMIT 1").get("legacy-unpriced")).toEqual({ state: "succeeded", prompt_tokens: 10, cost_usd: null });
  });

  test("scoped budgets count the row's owner, not the call's requested scope", async () => {
    const db = dbWithBudget(null, null);
    db.query("DELETE FROM budgets").run();
    db.query("INSERT INTO budgets (scope, ref, monthly_tokens, monthly_usd) VALUES ('project', 'ima', 1000, NULL)").run();
    db.query("INSERT INTO agent_runs (id, agent_id, project_id, tab, state, started_at, finished_at, summary, output, model, prompt_tokens, completion_tokens) VALUES ('other-project-run', 'audie', 'onboarding', 'overview', 'done', ?, ?, '', '', 'fake', 5000, 5000)").run(NOW.toISOString(), NOW.toISOString());
    await expect(callLlm(db, fake({ prompt: 1, completion: 1 }), { agentId: "audie", proj: "ima", runId: null }, messages, { maxTokens: 10 }, NOW)).resolves.toMatchObject({ content: "ok" });
  });

  test("ignores empty working run placeholders created before the reservation", async () => {
    const db = dbWithBudget(1000, null);
    db.query("INSERT INTO agent_runs (id, agent_id, project_id, tab, state, started_at, summary, output, model) VALUES ('working-run', 'audie', 'ima', 'overview', 'working', ?, '', '', NULL)").run(NOW.toISOString());
    await expect(callLlm(db, fake({ prompt: 1, completion: 1 }), { agentId: "audie", proj: "ima", runId: "working-run" }, messages, { maxTokens: 10 }, NOW)).resolves.toMatchObject({ content: "ok" });
  });

  test("imports a completed legacy run before linking a later judge call", async () => {
    const db = dbWithBudget(1000, null);
    db.query("INSERT INTO agent_runs (id, agent_id, project_id, tab, state, started_at, finished_at, summary, output, model, prompt_tokens, completion_tokens) VALUES ('legacy-run', 'audie', 'ima', 'overview', 'done', ?, ?, '', '', 'fake', 100, 50)").run(NOW.toISOString(), NOW.toISOString());
    await callLlm(db, fake({ prompt: 2, completion: 3 }), { agentId: "audie", proj: "ima", runId: "legacy-run" }, messages, { maxTokens: 10 }, NOW);
    expect(db.query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM llm_usage_ledger WHERE run_id = ?").get("legacy-run")?.n).toBe(2);
    expect(db.query<{ state: string; prompt_tokens: number }, [string]>("SELECT state, prompt_tokens FROM llm_usage_ledger WHERE run_id = ? ORDER BY id LIMIT 1").get("legacy-run")).toEqual({ state: "succeeded", prompt_tokens: 100 });
  });

  test("a stale reservation fails closed until its usage is reconciled", async () => {
    const db = dbWithBudget(1000, null);
    db.query("INSERT INTO llm_usage_ledger (run_id, agent_id, project_id, model, started_at, state, reserved_tokens, reserved_usd) VALUES (NULL, 'audie', 'ima', 'fake', ?, 'reserved', 10, 0)").run(NOW.toISOString());
    await expect(callLlm(db, fake({ prompt: 1, completion: 1 }), { agentId: "audie", proj: "ima", runId: null }, messages, { maxTokens: 10 }, NOW)).rejects.toThrow("known token capacity");
  });

  test("exposes ledger attempts and only unlinked legacy runs", async () => {
    const db = dbWithBudget(null, null);
    await callLlm(db, fake({ prompt: 4, completion: 2 }), { agentId: "audie", proj: "ima", runId: "linked-run" }, messages, { maxTokens: 10 }, NOW);
    db.query("INSERT INTO agent_runs (id, agent_id, project_id, tab, state, started_at, finished_at, summary, output, model, prompt_tokens, completion_tokens) VALUES ('linked-run', 'audie', 'ima', 'overview', 'done', ?, ?, '', '', 'fake', 4, 2)").run(NOW.toISOString(), NOW.toISOString());
    db.query("INSERT INTO agent_runs (id, agent_id, project_id, tab, state, started_at, finished_at, summary, output, model, prompt_tokens, completion_tokens) VALUES ('unlinked-run', 'audie', 'ima', 'overview', 'done', ?, ?, '', '', 'fake', 3, 1)").run(NOW.toISOString(), NOW.toISOString());
    const runs = loadUsageRuns(db, NOW, { fake: { input: 1, output: 2 } });
    expect(runs.map((r) => [r.id, r.source])).toEqual([["usage-1", "ledger"], ["unlinked-run", "legacy"]]);
    expect(runs.find((r) => r.id === "usage-1")?.costUsd).toBeCloseTo(0.000008);
  });
});
