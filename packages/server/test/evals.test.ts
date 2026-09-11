// Evals: rule checks on every run, an LLM judge with a rubric, human ratings,
// scorecards derived from all of it, benchmarks, and the workspace conversation
// (which is itself a run of the built-in "ask" agent).

import { describe, expect, test } from "bun:test";
import { agentScorecard, seedState, ungroundedTokens } from "@valueflow/domain";
import type { AgentRun, AppState, RunScore } from "@valueflow/domain";
import { routes } from "@valueflow/shared";
import { promptVersion, runAgent } from "../src/agents.ts";
import { createApp } from "../src/app.ts";
import { askWorkspace, workspaceBriefing } from "../src/chat.ts";
import { openDb } from "../src/db.ts";
import { judgeRun, ruleScores, runBenchmark } from "../src/evals.ts";
import type { ChatMessage, Llm } from "../src/llm.ts";
import { seed } from "../src/seed.ts";
import { BASE } from "./helpers.ts";

const NOW = new Date("2026-09-10T12:00:00Z");

/** A model that answers agents and the judge differently, keyed on the system prompt. */
const fakeLlm = (handlers: { agent?: (m: ChatMessage[]) => string; judge?: (m: ChatMessage[]) => string; chat?: (m: ChatMessage[]) => string }): Llm => ({
  model: () => Promise.resolve("fake"),
  chat: (messages) => {
    const sys = messages[0]?.content ?? "";
    const pick = sys.includes("impartial evaluator") ? handlers.judge : sys.includes("You are Ask") ? handlers.chat : handlers.agent;
    if (!pick) return Promise.reject(new Error("no handler"));
    return Promise.resolve({ content: pick(messages), model: "fake", usage: { prompt: 1200, completion: 300 }, truncated: false });
  },
  describe: () => ({ baseUrl: "http://fake", model: "fake", models: ["fake"], judgeModel: null }),
});

const AUDIT_REPLY = JSON.stringify({
  summary: "Recall 86% below the 88% gate; MS-21 blocked",
  attention: true,
  body: "## Recall gap\nRule recall is 86% against an 88% base gate on MS-21. Coverage is 74% on ima-rule-extractor. Made-up figure: 123456.",
  proposals: [{ type: "governance_status", gid: "sla", status: "draft", rationale: "SLA work described." }, { type: "governance_status", gid: "nope", status: "draft", rationale: "bad id" }],
});
const JUDGE_REPLY = (exp: number) =>
  JSON.stringify({
    groundedness: 7,
    completeness: 8,
    actionability: 6,
    clarity: 9,
    unsupported: ["123456"],
    expectations: Array.from({ length: exp }, (_, i) => ({ expectation: `e${i}`, met: i === 0, why: "because" })),
    critique: "Solid but one invented figure.",
  });

const appWith = (llm: Llm | null, autoJudge = false) => {
  const db = openDb(":memory:");
  seed(db);
  const app = createApp(db, { now: () => NOW, llm, autoJudge });
  const call = async <T>(method: string, path: string, body?: unknown) => {
    const res = await app.handleApi(new Request(BASE + path, { method, headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }));
    if (!res) throw new Error("not an api route");
    return { status: res.status, body: (await res.json()) as T };
  };
  return { app, db, call };
};

describe("rules", () => {
  test("grounding compares cited figures and ids against the briefing", () => {
    const g = ungroundedTokens("Recall is 86% on MS-21; coverage 74%; invented 123456 and R9.", "MS-21 rule recall 86 base 88; coverage 74");
    expect(g.cited.sort()).toEqual(["123456", "74%", "86%", "MS-21", "R9"]);
    expect(g.missing.sort()).toEqual(["123456", "R9"]);
  });
  test("a run gets format, grounding, and proposals_valid scores; a failed run scores 0 on format", async () => {
    const { db } = appWith(null);
    const run = await runAgent(db, fakeLlm({ agent: () => AUDIT_REPLY }), { agentId: "audie", proj: "ima" }, NOW);
    expect(run.promptVersion).toBe(promptVersion("audit"));
    expect(run.latencyMs).not.toBeNull();
    expect(run.promptTokens).toBe(1200);
    const scores: RunScore[] = db.query<{ scorer: string; dimension: string; score: number; note: string }, [string]>("SELECT scorer, dimension, score, note FROM run_scores WHERE run_id = ? ORDER BY dimension").all(run.id) as RunScore[];
    expect(scores.map((s) => `${s.scorer}:${s.dimension}=${s.score.toFixed(2)}`)).toEqual(["rules:format=1.00", "rules:grounding=0.80", "rules:proposals_valid=0.50"]);
    expect(scores[1]?.note).toContain("123456");
    const failed = await runAgent(db, fakeLlm({ agent: () => "nonsense" }), { agentId: "audie", proj: "ima" }, NOW);
    expect(ruleScores({ run: failed, briefing: "", proposalsReturned: 0, proposalsKept: 0 }, NOW.toISOString())).toEqual([{ runId: failed.id, scorer: "rules", dimension: "format", score: 0, note: expect.stringContaining("JSON") as string, at: NOW.toISOString() }]);
  });
});

describe("judge", () => {
  test("stores the four dimensions, a weighted overall, and expectations for benchmark runs; skips failed runs", async () => {
    const { db, call } = appWith(null);
    const llm = fakeLlm({ agent: () => AUDIT_REPLY, judge: () => JUDGE_REPLY(0) });
    const run = await runAgent(db, llm, { agentId: "audie", proj: "ima" }, NOW);
    const scores = await judgeRun(db, llm, run.id, NOW);
    const by = Object.fromEntries(scores.map((s) => [s.dimension, s.score]));
    expect(by).toEqual({ groundedness: 0.7, completeness: 0.8, actionability: 0.6, clarity: 0.9, overall: (7 * 2 + 8 + 6 + 9) / 50 });
    expect(scores.find((s) => s.dimension === "groundedness")?.note).toContain("123456");
    expect(scores.find((s) => s.dimension === "overall")?.note).toBe("Solid but one invented figure.");
    const state = (await call<AppState>("GET", routes.state())).body;
    expect(state.scores.filter((s) => s.runId === run.id && s.scorer === "judge").length).toBe(5);
    const failed = await runAgent(db, fakeLlm({ agent: () => "nope" }), { agentId: "audie", proj: "ima" }, NOW);
    expect(await judgeRun(db, llm, failed.id, NOW)).toEqual([]);
  });

  test("the judge route and auto-judge grade through the API", async () => {
    const { call } = appWith(fakeLlm({ agent: () => AUDIT_REPLY, judge: () => JUDGE_REPLY(0) }), true);
    const run = (await call<AgentRun>("POST", routes.agentRuns("audie"), { proj: "ima" })).body;
    await new Promise((r) => setTimeout(r, 30));
    const scores = (await call<RunScore[]>("POST", routes.runJudge(run.id))).body;
    expect(scores.length).toBe(5);
    expect((await call<AppState>("GET", routes.state())).body.scores.some((s) => s.runId === run.id && s.dimension === "overall")).toBe(true);
    expect((await call("POST", routes.runJudge("run-999"))).status).toBe(404);
  });
});

describe("ratings and scorecards", () => {
  test("a rating is stored on the run and everything rolls up into the scorecard", async () => {
    const { db, call } = appWith(null);
    const llm = fakeLlm({ agent: () => AUDIT_REPLY, judge: () => JUDGE_REPLY(0) });
    const run = await runAgent(db, llm, { agentId: "audie", proj: "ima" }, NOW);
    await judgeRun(db, llm, run.id, NOW);
    const rated = await call<AgentRun>("POST", routes.runRate(run.id), { rating: 1, note: "spot on" });
    expect(rated.body.rating).toBe(1);
    expect(rated.body.ratingNote).toBe("spot on");
    expect((await call("POST", routes.runRate("run-999"), { rating: -1 })).status).toBe(404);
    const state = (await call<AppState>("GET", routes.state())).body;
    const pending = state.proposals.find((p) => p.runId === run.id)!;
    await call("POST", routes.proposalAccept(pending.id));
    const after = (await call<AppState>("GET", routes.state())).body;
    const card = agentScorecard(state.agents.find((a) => a.id === "audie")!, after.runs, after.scores, after.proposals, after.asOf);
    expect(card.runs).toBe(5);
    expect(card.rules.grounding).toBe(0.8);
    expect(card.judge.overall).toBeCloseTo(0.74, 5);
    expect(card.judge.judged).toBe(1);
    expect(card.ratings).toEqual({ up: 1, down: 0 });
    expect(card.proposals).toEqual({ total: 1, accepted: 1, dismissed: 0, acceptanceRate: 1 });
    expect(card.latencyMedianMs).not.toBeNull();
    expect(card.benchmarks).toEqual([]);
  });
});

describe("benchmark", () => {
  test("runs each case for one agent, judges expectations, and the scorecard shows the batch", async () => {
    const { db, call } = appWith(null);
    const llm = fakeLlm({ agent: () => AUDIT_REPLY, judge: () => JUDGE_REPLY(4) });
    const runs = await runBenchmark(db, llm, NOW, "audie");
    expect(runs.map((r) => r.benchmark)).toEqual(["audie-ima-audit", "audie-sector-habits"]);
    const state = (await call<AppState>("GET", routes.state())).body;
    const card = agentScorecard({ id: "audie" }, state.runs, state.scores, state.proposals, state.asOf);
    expect(card.runs).toBe(4);
    expect(card.benchmarks.length).toBe(1);
    expect(card.benchmarks[0]).toMatchObject({ n: 2, failed: 0, promptVersion: promptVersion("audit"), model: "fake" });
    // 1 of 4 expectations met on the first case, 1 of 3 on the second.
    expect(card.benchmarks[0]?.expectations).toBeCloseTo((0.25 + 1 / 3) / 2, 5);
    expect(state.scores.find((s) => s.dimension === "expectations")?.note).toContain("✓ e0");
  });
  test("the benchmark route refuses without a model and reports status", async () => {
    const { call } = appWith(null);
    expect((await call("POST", routes.benchmark(), {})).status).toBe(409);
    const withLlm = appWith(fakeLlm({ agent: () => AUDIT_REPLY, judge: () => JUDGE_REPLY(3) }));
    expect((await withLlm.call<{ running: boolean }>("POST", routes.benchmark(), { agentId: "audie" })).status).toBe(202);
    await new Promise((r) => setTimeout(r, 50));
    const status = (await withLlm.call<{ running: boolean; done: number; total: number }>("GET", routes.benchmark())).body;
    expect(status.total).toBe(2);
  });
});

describe("workspace conversation", () => {
  test("the briefing covers every project; an answer stores a run of Ask with links and proposals", async () => {
    const st = seedState();
    const { calendarOf } = require("@valueflow/domain") as typeof import("@valueflow/domain");
    const brief = workspaceBriefing(st, calendarOf(st));
    expect(brief).toContain("## IMA compliance rule extraction (id: ima, PRJ-7)");
    expect(brief).toContain("R1 Shadow mode (Oct, Blocked, 1/4)");
    expect(brief).toContain("Product SLA (id: sla, Missing)");

    const { db, call } = appWith(null);
    const llm = fakeLlm({
      chat: (m) => {
        expect(m[0]?.content).toContain("# The project the user is looking at, in full");
        return JSON.stringify({
          answer: "R1 is blocked: recall is 86% against the 88% base gate, and the security review and model risk assessment are still in review.",
          links: [{ label: "IMA roadmap", proj: "ima", tab: "roadmap" }, { label: "bogus", proj: "nope", tab: "value" }],
          proposals: [{ type: "calendar_event", proj: "ima", date: "2026-09-16", text: "Recall gate decision", sub: null, tab: "value", rationale: "Closest fix." }],
        });
      },
    });
    const reply = await askWorkspace(db, llm, { messages: [{ role: "user", content: "Why is R1 blocked?" }], proj: "ima" }, NOW);
    expect(reply.answer).toContain("86%");
    expect(reply.links).toEqual([{ label: "IMA roadmap", proj: "ima", tab: "roadmap" }]);
    expect(reply.proposals.length).toBe(1);
    expect(reply.proposals[0]?.action).toEqual({ type: "calendar_event", date: "2026-09-16", text: "Recall gate decision", sub: null, tab: "value" });
    const state = (await call<AppState>("GET", routes.state())).body;
    const run = state.runs.find((r) => r.id === reply.runId)!;
    expect(run).toMatchObject({ agentId: "ask", proj: "ima", state: "done", instruction: "Why is R1 blocked?" });
    expect(state.scores.some((s) => s.runId === run.id && s.dimension === "grounding" && s.score === 1)).toBe(true);
  });

  test("the chat route validates and refuses without a model", async () => {
    const { call } = appWith(null);
    expect((await call("POST", routes.chat(), { messages: [{ role: "user", content: "hi" }] })).status).toBe(409);
    const withLlm = appWith(fakeLlm({ chat: () => JSON.stringify({ answer: "Hello", links: [], proposals: [] }) }));
    expect((await withLlm.call("POST", routes.chat(), { messages: [] })).status).toBe(400);
    const ok = await withLlm.call<{ answer: string; runId: string }>("POST", routes.chat(), { messages: [{ role: "user", content: "hi" }] });
    expect(ok.status).toBe(200);
    expect(ok.body.answer).toBe("Hello");
  });
});
