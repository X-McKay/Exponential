// Cost governance end to end: budgets are set through the API, spend derives
// from runs, a reached ceiling refuses manual runs and pauses scheduled ones,
// Glance says so, and the scout counts cost when it compares models.

import { describe, expect, test } from "bun:test";
import { composeGlance, defaultBrief, modelComparison } from "@valueflow/domain";
import type { AgentRun, AppState, Budget } from "@valueflow/domain";
import { routes } from "@valueflow/shared";
import { createApp } from "../src/app.ts";
import { openDb } from "../src/db.ts";
import type { ChatMessage, ChatOptions, Llm } from "../src/llm.ts";
import { loadState, updateRun } from "../src/repo.ts";
import { runDue } from "../src/runner.ts";
import type { Skipped } from "../src/runner.ts";
import { verdict } from "../src/scout.ts";
import { seed } from "../src/seed.ts";
import { BASE } from "./helpers.ts";

const NOW = new Date("2026-09-10T12:00:00Z");

const fakeLlm = (handler: (m: ChatMessage[], o: ChatOptions) => string): Llm => ({
  model: () => Promise.resolve("fake"),
  chat: (messages, options = {}) => Promise.resolve({ content: handler(messages, options), model: options.model ?? "fake", usage: { prompt: 900, completion: 300 }, truncated: false }),
  describe: () => ({ baseUrl: "http://fake", model: "fake", models: ["fake"], judgeModel: null, prices: { fake: { input: 1000, output: 2000 } } }),
});

const reply = () => JSON.stringify({ summary: "fine", attention: false, body: "## Finding\nNothing much.", proposals: [] });

const appWith = (llm: Llm | null) => {
  const db = openDb(":memory:");
  seed(db);
  const app = createApp(db, { now: () => NOW, llm, autoJudge: false });
  const call = async <T>(method: string, path: string, body?: unknown) => {
    const res = await app.handleApi(new Request(BASE + path, { method, headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }));
    if (!res) throw new Error("not an api route");
    return { status: res.status, body: (await res.json()) as T };
  };
  return { app, db, call };
};

describe("budgets", () => {
  test("budgets round-trip, validate their targets, and drop empty lines", async () => {
    const { call } = appWith(null);
    const put = await call<Budget[]>("PUT", routes.budgets(), [
      { scope: "workspace", monthlyUsd: 50 },
      { scope: "agent", ref: "audie", monthlyTokens: 2_000_000 },
      { scope: "project", ref: "ima", monthlyUsd: null, monthlyTokens: null },
    ]);
    expect(put.status).toBe(200);
    expect(put.body).toEqual([
      { scope: "agent", ref: "audie", monthlyTokens: 2_000_000, monthlyUsd: null },
      { scope: "workspace", ref: "", monthlyTokens: null, monthlyUsd: 50 },
    ]);
    expect((await call<AppState>("GET", routes.state())).body.budgets).toEqual(put.body);
    expect((await call("PUT", routes.budgets(), [{ scope: "agent", ref: "nobody", monthlyUsd: 1 }])).status).toBe(400);
    expect((await call("PUT", routes.budgets(), [{ scope: "project", ref: "nope", monthlyUsd: 1 }])).status).toBe(400);
  });

  test("a reached ceiling refuses manual runs for that scope, the scheduler skips them, and Glance carries the signal", async () => {
    const llm = fakeLlm(reply);
    const { db, call } = appWith(llm);
    // One run at $1000/M in, $2000/M out: 900 in + 300 out = $1.50.
    const first = await call<AgentRun>("POST", routes.agentRuns("audie"), { proj: "ima" });
    expect(first.status).toBe(201);
    await call("PUT", routes.budgets(), [{ scope: "agent", ref: "audie", monthlyUsd: 1 }]);
    const refused = await call<{ error: string }>("POST", routes.agentRuns("audie"), { proj: "sector" });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/^over budget: Audie has used \$1\.50 of its \$1\.00 monthly budget/);
    // Other agents still run.
    expect((await call("POST", routes.agentRuns("comma"), { proj: "ima" })).status).toBe(201);
    // The scheduler holds Audie back and says why.
    const later = new Date("2026-09-11T12:00:00Z");
    const skipped: Skipped[] = [];
    const runs = await runDue(db, llm, later, {}, skipped);
    expect(runs.some((r) => r.agentId === "audie")).toBe(false);
    expect(skipped.filter((s) => s.agentId === "audie").map((s) => s.proj)).toEqual(["onboarding", "ima", "sector"]);
    expect(runs.some((r) => r.agentId === "sentry")).toBe(true);
    // Glance: a budget block and a brief item.
    const state = { ...loadState(db, NOW), llm: llm.describe() };
    const block = composeGlance(state).find((b) => b.kind === "budget");
    expect(block?.tone).toBe("bad");
    expect(block?.title).toMatch(/^Audie: \$1\.50 of the \$1\.00 monthly budget used \(150%\)/);
    const item = defaultBrief(state).sections.find((s) => s.text.includes("monthly budget"));
    expect(item?.group).toBe("top");
    expect(item?.action).toEqual({ label: "View spend", proj: "agents", tab: "overview" });
    // A workspace ceiling stops everything, including the chat and the curator.
    await call("PUT", routes.budgets(), [{ scope: "workspace", ref: "", monthlyUsd: 0.5 }]);
    expect((await call("POST", routes.chat(), { messages: [{ role: "user", content: "hi" }] })).status).toBe(409);
    expect((await call("POST", routes.glanceCurate())).status).toBe(409);
    expect((await call("POST", routes.benchmark(), {})).status).toBe(409);
  });

  test("the scout prefers a model that is as good and clearly cheaper", async () => {
    const { db } = appWith(null);
    const st = loadState(db, NOW);
    const audie = st.agents.find((a) => a.id === "audie")!;
    const mk = (id: string, model: string, tokens: number): AgentRun => ({ id, agentId: "audie", proj: "ima", tab: "overview", state: "done", startedAt: NOW.toISOString(), finishedAt: NOW.toISOString(), instruction: null, summary: "", output: "", model, error: null, promptVersion: "v", latencyMs: 5000, promptTokens: tokens, completionTokens: tokens, benchmark: "audie-ima-audit", rating: null, ratingNote: null });
    const runs = [mk("run-a", "big", 1000), mk("run-b", "small", 1000)];
    for (const r of runs) db.query("INSERT INTO agent_runs (id, agent_id, project_id, tab, state, started_at, finished_at, summary, output, model, prompt_version, latency_ms, prompt_tokens, completion_tokens, benchmark) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(r.id, r.agentId, r.proj, r.tab, r.state, r.startedAt, r.finishedAt, r.summary, r.output, r.model, r.promptVersion, r.latencyMs, r.promptTokens, r.completionTokens, r.benchmark);
    for (const r of runs) updateRun(db, r);
    for (const [id, score] of [["run-a", 0.9], ["run-b", 0.89]] as const) db.query("INSERT INTO run_scores (run_id, scorer, dimension, score, note, at) VALUES (?,?,?,?,?,?)").run(id, "judge", "overall", score, "", NOW.toISOString());
    const s2 = loadState(db, NOW);
    const rows = modelComparison(audie, s2.runs, s2.scores, "v", { big: { input: 10, output: 10 }, small: { input: 1, output: 1 } });
    expect(rows.map((r) => [r.model, r.costMean])).toEqual([
      ["big", 0.02],
      ["small", 0.002],
    ]);
    const v = verdict(audie, "big", rows);
    expect(v.recommend?.model).toBe("small");
    expect(v.reason).toMatch(/^same quality \(89% vs 90%\) at \$0\.00 instead of \$0\.02 per run/);
    // Without prices the same rows fall back to the latency rule, which these tie on.
    expect(verdict(audie, "big", modelComparison(audie, s2.runs, s2.scores, "v")).recommend).toBeNull();
  });
});
