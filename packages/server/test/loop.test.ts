// The closed loop: standing rules that become proposals (and, once trusted,
// apply themselves), a tuner that proposes prompt changes from measured runs,
// a scout that compares models on the same cases, and a weekly brief over the
// whole workspace. Every step is a run or a proposal, never a hidden change.

import { describe, expect, test } from "bun:test";
import { composeGlance, isDue, modelComparison, promptHistory, promptVersion, ruleStats, weekStart } from "@valueflow/domain";
import type { Agent, AgentRun, AppState, Proposal, Rule } from "@valueflow/domain";
import { routes } from "@valueflow/shared";
import { runAgent } from "../src/agents.ts";
import { createApp } from "../src/app.ts";
import { runBrief } from "../src/brief.ts";
import type { BriefMessage } from "../src/brief.ts";
import { openDb } from "../src/db.ts";
import { createLlm } from "../src/llm.ts";
import type { ChatMessage, ChatOptions, Llm } from "../src/llm.ts";
import { loadState } from "../src/repo.ts";
import { runAny } from "../src/runner.ts";
import { scoutModels } from "../src/scout.ts";
import { seed } from "../src/seed.ts";
import { tuneAgent } from "../src/tuner.ts";
import { BASE } from "./helpers.ts";

const NOW = new Date("2026-09-10T12:00:00Z");

type Handler = (messages: ChatMessage[], options: ChatOptions) => string;

/** A model whose reply depends on who is asking (system prompt) and which model was requested. */
const fakeLlm = (handler: Handler, models = ["fake"]): Llm => ({
  model: () => Promise.resolve("fake"),
  chat: (messages, options = {}) => Promise.resolve({ content: handler(messages, options), model: options.model ?? "fake", usage: { prompt: 900, completion: 200 }, truncated: false }),
  describe: () => ({ baseUrl: "http://fake", model: "fake", models, judgeModel: null, prices: {} }),
});

const sys = (m: ChatMessage[]) => m[0]?.content ?? "";
const user = (m: ChatMessage[]) => m[1]?.content ?? "";

const judgeReply = (score: number) => JSON.stringify({ groundedness: score, completeness: score, actionability: score, clarity: score, unsupported: [], expectations: [{ expectation: "x", met: score >= 8, why: "because" }], critique: score >= 8 ? "Strong." : "Weak: vague findings, one invented figure." });

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

describe("standing rules", () => {
  const RULES_REPLY = (m: ChatMessage[]) => {
    const ids = [...user(m).matchAll(/^- (rule-\d+)/gm)].map((x) => x[1]);
    return JSON.stringify({
      summary: "rule-2 fires",
      attention: false,
      body: "## rule-1\nDOES NOT FIRE\n## rule-2\nFIRES: the runbook is described as complete.",
      proposals: [
        { type: "governance_status", gid: "sla", status: "approved", rationale: "Runbook complete per activity.", rule: ids[1] ?? "rule-2" },
        { type: "calendar_event", date: "2026-09-20", text: "Freelance event", sub: null, tab: "overview", rationale: "no rule asked" },
        { type: "milestone_status", mid: "MS-21", status: "shipped", rationale: "bogus rule", rule: "rule-99" },
      ],
    });
  };

  test("the rules agent is briefed with the applicable rules, ties every kept proposal to a rule, and drops the rest", async () => {
    const { db } = appWith(null);
    const seen: string[] = [];
    const llm = fakeLlm((m) => {
      seen.push(user(m));
      return RULES_REPLY(m);
    });
    const run = await runAgent(db, llm, { agentId: "sentry", proj: "clauses" }, NOW);
    expect(run.state).toBe("done");
    expect(seen[0]).toContain("Standing rules to check");
    expect(seen[0]).toContain("- rule-1 (owner JA)");
    const props = loadState(db, NOW).proposals.filter((p) => p.runId === run.id);
    expect(props.map((p) => [p.action.type, p.ruleId])).toEqual([["governance_status", "rule-2"]]);
    expect(props[0]?.state).toBe("pending");
    expect(ruleStats({ id: "rule-2" }, props)).toMatchObject({ fired: 1, pending: 1, acceptanceRate: null, earnedAutonomy: false });
  });

  test("an unearned rule cannot enable autonomy; a project with no applicable rules is refused", async () => {
    const llm = fakeLlm(RULES_REPLY);
    const { db, call } = appWith(llm);
    const put = await call<Rule>("PUT", routes.rule("rule-2"), { text: "If a runbook is complete, approve the SLA.", proj: "clauses", enabled: true, auto: true, owner: "TO" });
    expect(put.status).toBe(409);
    const run = await runAgent(db, llm, { agentId: "sentry", proj: "clauses" }, NOW);
    const state = loadState(db, NOW);
    const p = state.proposals.find((x) => x.runId === run.id);
    expect(p?.state).toBe("pending");
    expect(state.projects.find((x) => x.id === "clauses")?.governance.find((g) => g.id === "sla")?.status).not.toBe("approved");
    // Disable every rule for sector and the agent has nothing to check there.
    for (const r of state.rules) await call("PUT", routes.rule(r.id), { text: r.text, proj: r.proj, enabled: false, auto: false, owner: r.owner });
    const refused = await call<{ error: string }>("POST", routes.agentRuns("sentry"), { proj: "search" });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toContain("no enabled standing rules");
  });

  test("rules are created, listed, edited, and deleted through the API", async () => {
    const { call } = appWith(null);
    const created = await call<Rule>("POST", routes.rules(), { text: "When coverage on any repo drops below 60%, add a calendar event for a coverage review.", proj: null, owner: "JA" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ id: "rule-5", enabled: true, auto: false, proj: null });
    expect((await call<Rule[]>("GET", routes.rules())).body.map((r) => r.id)).toEqual(["rule-1", "rule-2", "rule-3", "rule-4", "rule-5"]);
    expect((await call("POST", routes.rules(), { text: "short", owner: "JA" })).status).toBe(400);
    expect((await call("POST", routes.rules(), { text: "A perfectly fine rule for a project that does not exist.", proj: "nope", owner: "JA" })).status).toBe(400);
    expect((await call("DELETE", routes.rule("rule-5"))).status).toBe(200);
    expect((await call("DELETE", routes.rule("rule-5"))).status).toBe(404);
    expect((await call<AppState>("GET", routes.state())).body.rules.length).toBe(4);
  });

  test("weekly schedules are due once per week from Monday; the earned-autonomy threshold needs enough decisions", () => {
    expect(weekStart("2026-09-10T12:00:00Z")).toBe("2026-09-07T00:00:00.000Z");
    const weekly: Agent = { id: "w", name: "W", grad: "", purpose: "", kind: "brief", model: null, owner: "JA", caps: [], schedule: "weekly", prompt: null };
    const run = (startedAt: string): AgentRun => ({ id: "run-1", agentId: "w", proj: null, tab: "overview", state: "done", startedAt, finishedAt: startedAt, instruction: null, summary: "", output: "", model: "m", error: null, promptVersion: null, latencyMs: null, promptTokens: null, completionTokens: null, benchmark: null, rating: null, ratingNote: null });
    expect(isDue(weekly, [], "2026-09-10T12:00:00Z")).toBe(true);
    expect(isDue(weekly, [run("2026-09-06T23:00:00Z")], "2026-09-10T12:00:00Z")).toBe(true);
    expect(isDue(weekly, [run("2026-09-07T01:00:00Z")], "2026-09-10T12:00:00Z")).toBe(false);
    const props = (n: number, accepted: number): Proposal[] => Array.from({ length: n }, (_, i) => ({ id: `prop-${i}`, runId: "run-1", agentId: "sentry", proj: "clauses", ruleId: "rule-1", action: { type: "targets", fte: 1, time: 1 }, rationale: "", state: i < accepted ? "accepted" : "dismissed", createdAt: "2026-09-01T00:00:00Z", decidedAt: "2026-09-01T00:00:00Z" }));
    expect(ruleStats({ id: "rule-1" }, props(4, 4)).earnedAutonomy).toBe(false);
    expect(ruleStats({ id: "rule-1" }, props(5, 4)).earnedAutonomy).toBe(true);
    expect(ruleStats({ id: "rule-1" }, props(5, 3)).earnedAutonomy).toBe(false);
  });
});

describe("prompt tuning", () => {
  const AUDIT = JSON.stringify({ summary: "Findings", attention: false, body: "## Finding\nRecall 86% vs 88%. Coverage 12345%.", proposals: [] });
  const TUNE = JSON.stringify({ analysis: "## Weak grounding\nrun-15 and run-16 cite figures not in the briefing.", prompt: "Before citing any figure, find it in the briefing; if absent write 'not in briefing'.", change: "Grounding should rise from 50% toward 100%." });
  const handler: Handler = (m) => (sys(m).includes("prompt tuner") ? TUNE : sys(m).includes("impartial evaluator") ? judgeReply(5) : AUDIT);

  test("the tuner needs measured runs, then proposes new instructions; accepting records a version, changes the prompt, and re-benchmarks", async () => {
    const { db, call } = appWith(fakeLlm(handler));
    const coach = loadState(db, NOW).agents.find((a) => a.kind === "tuner")!;
    // Comma has only two finished sample runs: not enough.
    const thin = await tuneAgent(db, fakeLlm(handler), coach, "comma", NOW);
    expect(thin.state).toBe("done");
    expect(thin.summary).toContain("not enough measured runs");
    expect(loadState(db, NOW).proposals.filter((p) => p.runId === thin.id)).toEqual([]);

    const before = promptVersion("audit", null);
    const r1 = await runAgent(db, fakeLlm(handler), { agentId: "audie", proj: "clauses" }, NOW);
    expect(r1.promptVersion).toBe(before);
    const tuned = await tuneAgent(db, fakeLlm(handler), coach, "audie", NOW);
    expect(tuned.state).toBe("done");
    expect(tuned.proj).toBeNull();
    expect(tuned.output).toContain("Proposed extra instructions for Audie");
    const proposal = loadState(db, NOW).proposals.find((p) => p.runId === tuned.id)!;
    expect(proposal.action).toEqual({ type: "agent_prompt", agentId: "audie", prompt: "Before citing any figure, find it in the briefing; if absent write 'not in briefing'." });
    expect(proposal.proj).toBeNull();

    const accepted = await call<Proposal>("POST", routes.proposalAccept(proposal.id));
    expect(accepted.status).toBe(200);
    // The benchmark for Audie starts in the background; wait for it.
    for (let i = 0; i < 50; i++) {
      const st = await call<{ running: boolean; kind: string | null }>("GET", routes.benchmark());
      if (!st.body.running) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    const state = loadState(db, NOW);
    const audie = state.agents.find((a) => a.id === "audie")!;
    expect(audie.prompt).toBe(proposal.action.type === "agent_prompt" ? proposal.action.prompt : "");
    const after = promptVersion("audit", audie.prompt);
    expect(after).not.toBe(before);
    expect(state.promptVersions).toEqual([{ agentId: "audie", version: after, prompt: audie.prompt, at: NOW.toISOString(), source: "tuner" }]);
    const bench = state.runs.filter((r) => r.agentId === "audie" && r.benchmark !== null);
    expect(bench.length).toBe(3);
    expect(bench.every((r) => r.promptVersion === after)).toBe(true);
    const history = promptHistory(audie, after, state.runs, state.scores, state.promptVersions);
    expect(history.map((h) => [h.version, h.current, h.source, h.benchmark.n])).toEqual([
      [after, true, "tuner", 3],
      [before, false, "builtin", 0],
    ]);
    // The new instructions reach the next run's system prompt.
    const seen: string[] = [];
    await runAgent(
      db,
      fakeLlm((m) => {
        seen.push(sys(m));
        return AUDIT;
      }),
      { agentId: "audie", proj: "clauses" },
      NOW,
    );
    expect(seen[0]).toContain("Additional instructions from the workspace");
    expect(seen[0]).toContain("find it in the briefing");
  });

  test("editing instructions by hand records a person version, through the prompt route or the agents document", async () => {
    const { call } = appWith(null);
    const viaRoute = await call<Agent>("POST", routes.agentPrompt("nova"), { prompt: "Rank by effort first." });
    expect(viaRoute.status).toBe(200);
    expect(viaRoute.body.prompt).toBe("Rank by effort first.");
    const agents = (await call<AppState>("GET", routes.state())).body.agents;
    const viaDoc = await call("PUT", routes.agents(), agents.map((a) => (a.id === "slider" ? { ...a, prompt: "Ten slides at most." } : a)));
    expect(viaDoc.status).toBe(200);
    const versions = (await call<AppState>("GET", routes.state())).body.promptVersions;
    expect(versions.map((v) => [v.agentId, v.source, v.prompt])).toEqual([
      ["slider", "person", "Ten slides at most."],
      ["nova", "person", "Rank by effort first."],
    ]);
    expect((await call("POST", routes.agentPrompt("nobody"), { prompt: null })).status).toBe(404);
  });
});

describe("model scouting", () => {
  // The "better" model writes grounded findings; the judge rewards them. "fake" is the default.
  const handler: Handler = (m, o) => {
    if (sys(m).includes("impartial evaluator")) return judgeReply(user(m).includes("GROUNDED") ? 9 : 5);
    return JSON.stringify({ summary: "Findings", attention: false, body: o.model === "better" ? "## GROUNDED\nRecall 86% vs 88%." : "## Vague\nThings look fine.", proposals: [] });
  };

  test("the scout benchmarks every candidate on the same cases, proposes a switch when a candidate clearly wins, and the switch routes runs to that model", async () => {
    const llm = fakeLlm(handler, ["fake", "better", "worse"]);
    const { db, call } = appWith(llm);
    const scout = loadState(db, NOW).agents.find((a) => a.kind === "scout")!;
    const progress: number[] = [];
    const run = await scoutModels(db, llm, scout, NOW, { agentId: "audie", onProgress: (d) => progress.push(d) });
    expect(run.state).toBe("done");
    expect(run.proj).toBeNull();
    expect(progress).toEqual([0, 1, 2, 3]);
    expect(run.summary).toContain("Audie → better");
    expect(run.output).toContain("| better |");
    const state = loadState(db, NOW);
    const rows = modelComparison({ id: "audie" }, state.runs, state.scores, promptVersion("audit", null));
    expect(rows.map((r) => [r.model, r.n, r.overall])).toEqual([
      ["better", 3, 0.9],
      ["fake", 3, 0.5],
      ["worse", 3, 0.5],
    ]);
    const proposal = state.proposals.find((p) => p.runId === run.id)!;
    expect(proposal.action).toEqual({ type: "agent_model", agentId: "audie", model: "better" });
    expect(proposal.rationale).toContain("90% vs 50%");
    expect((await call("POST", routes.proposalAccept(proposal.id))).status).toBe(200);
    expect(loadState(db, NOW).agents.find((a) => a.id === "audie")?.model).toBe("better");
    const next = await runAgent(db, llm, { agentId: "audie", proj: "clauses" }, NOW);
    expect(next.model).toBe("better");
    expect(next.output).toContain("GROUNDED");
    // Nothing more to propose: the current model now leads.
    const again = await scoutModels(db, llm, scout, NOW, { agentId: "audie" });
    expect(again.summary).toContain("the current model holds");
  });

  test("with a single model the scout reports and stops; the scout route runs it in the background", async () => {
    const llm = fakeLlm(handler);
    const { db, call } = appWith(llm);
    const scout = loadState(db, NOW).agents.find((a) => a.kind === "scout")!;
    const run = await scoutModels(db, llm, scout, NOW, {});
    expect(run.summary).toContain("Only one model");
    const started = await call<{ running: boolean; kind: string }>("POST", routes.scout(), {});
    expect(started.status).toBe(202);
    expect(started.body.kind).toBe("scout");
    expect((await call("POST", routes.benchmark(), {})).status).toBe(409);
    for (let i = 0; i < 50; i++) {
      if (!(await call<{ running: boolean }>("GET", routes.benchmark())).body.running) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(loadState(db, NOW).runs.filter((r) => r.agentId === "scout").length).toBe(2);
  });

  test("a model spec may name another endpoint, and the judge model is honoured", async () => {
    const calls: { url: string; model: string }[] = [];
    const llm = createLlm({
      baseUrl: "http://a.test/v1",
      model: "m1",
      candidates: ["m2@http://b.test/v1"],
      judgeModel: "judge-x",
      fetch: (url, init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as { model: string };
        calls.push({ url, model: body.model });
        return Promise.resolve(Response.json({ model: body.model, choices: [{ message: { content: "{}" }, finish_reason: "stop" }] }));
      },
    });
    expect(llm.describe()).toEqual({ baseUrl: "http://a.test/v1", model: "m1", models: ["m1", "m2@http://b.test/v1"], judgeModel: "judge-x", prices: {} });
    await llm.chat([{ role: "user", content: "hi" }]);
    const r = await llm.chat([{ role: "user", content: "hi" }], { model: "m2@http://b.test/v1" });
    expect(r.model).toBe("m2@http://b.test/v1");
    expect(calls).toEqual([
      { url: "http://a.test/v1/chat/completions", model: "m1" },
      { url: "http://b.test/v1/chat/completions", model: "m2" },
    ]);
  });
});

describe("weekly brief", () => {
  const BRIEF = JSON.stringify({ summary: "R1 still blocked on recall; two decisions wait on you", body: "## What moved\n- Ops documentation moved to In review.\n## What is blocked\n- R1 Shadow mode: recall 86% vs 88%.\n## Decisions waiting on you\n- none\n## Proposals pending\n- none", links: [{ label: "R1 criteria", proj: "clauses", tab: "roadmap" }, { label: "bad", proj: "nope", tab: "value" }] });
  const handler: Handler = (m) => (sys(m).includes("weekly-brief") ? BRIEF : "{}");

  test("the brief is a workspace-level run with links, delivered when a channel is configured, and shows on Glance", async () => {
    const { db } = appWith(null);
    const monday = loadState(db, NOW).agents.find((a) => a.kind === "brief")!;
    const delivered: BriefMessage[] = [];
    const seen: string[] = [];
    const run = await runBrief(
      db,
      fakeLlm((m) => {
        seen.push(user(m));
        return handler(m, {});
      }),
      monday,
      NOW,
      {
        deliver: (msg) => {
          delivered.push(msg);
          return Promise.resolve(true);
        },
      },
    );
    expect(run.state).toBe("done");
    expect(run.proj).toBeNull();
    expect(seen[0]).toContain("Brief for Jordan Avery (JA)");
    expect(seen[0]).toContain("What moved this week");
    expect(run.output).toContain("## Where to look\n- R1 criteria — Contract Clause Review");
    expect(run.output).not.toContain("bad");
    expect(run.output).toContain("Delivered to the configured channel");
    expect(delivered.length).toBe(1);
    expect(delivered[0]?.title).toBe("Your week — 2026-09-10");
    expect(delivered[0]?.text).toContain("R1 still blocked");
    const blocks = composeGlance(loadState(db, NOW));
    const card = blocks.find((b) => b.kind === "brief");
    expect(card?.title).toBe("R1 still blocked on recall; two decisions wait on you");
    expect(blocks[0]?.kind).toBe("brief");
  });

  test("the runs route dispatches by kind: the brief needs no project, a project agent does", async () => {
    const { call } = appWith(fakeLlm(handler));
    const brief = await call<AgentRun>("POST", routes.agentRuns("monday"), {});
    expect(brief.status).toBe(201);
    expect(brief.body.proj).toBeNull();
    expect(brief.body.output).not.toContain("Delivered");
    const missing = await call<{ error: string }>("POST", routes.agentRuns("audie"), {});
    expect(missing.status).toBe(409);
    expect(missing.body.error).toContain("needs a project");
    const { db } = appWith(null);
    const state = loadState(db, NOW);
    const coach = state.agents.find((a) => a.kind === "tuner")!;
    const runs = await runAny(db, fakeLlm(() => JSON.stringify({ analysis: "fine", prompt: "", change: "" })), { agentId: coach.id }, NOW);
    expect(runs.map((r) => r.instruction)).toEqual(["Tune Slider", "Tune Comma", "Tune Nova", "Tune Audie", "Tune Ask", "Tune Sentry", "Tune Monday", "Tune Project Manager"]);
  });
});
