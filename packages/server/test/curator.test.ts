// Generative Glance as a daily brief: the composer finds signals, the curator
// writes prose from them with widgets that point at facts by id. Invalid
// widgets are dropped, prose is grounding-checked, the composer's own brief
// is the fallback, and "since you last looked" starts at the reader's visit.

import { describe, expect, test } from "bun:test";
import { blocksHash, calendarOf, composeGlance, defaultBrief, parseWidget, resolveWidget } from "@valueflow/domain";
import type { AgentRun, AppState, DailyBrief, Workspace } from "@valueflow/domain";
import { routes } from "@valueflow/shared";
import { createApp } from "../src/app.ts";
import { briefIsCurrent, curateGlance, curatorContext, sentenceCase } from "../src/curator.ts";
import { openDb } from "../src/db.ts";
import { runBenchmark } from "../src/evals.ts";
import type { ChatMessage, ChatOptions, Llm } from "../src/llm.ts";
import { loadState } from "../src/repo.ts";
import { seed } from "../src/seed.ts";
import { BASE } from "./helpers.ts";

const NOW = new Date("2026-09-10T12:00:00Z");

const fakeLlm = (handler: (m: ChatMessage[], o: ChatOptions) => string): Llm => ({
  model: () => Promise.resolve("fake"),
  chat: (messages, options = {}) => Promise.resolve({ content: handler(messages, options), model: "fake", usage: { prompt: 700, completion: 150 }, truncated: false }),
  describe: () => ({ baseUrl: "http://fake", model: "fake", models: ["fake"], judgeModel: null }),
});

/** A curator that writes three sections: a release widget, a table with one invented figure, and a widget pointing nowhere. */
const curatorReply = () =>
  JSON.stringify({
    headline: "R1 is blocked on recall; nothing else needs you today",
    sections: [
      { group: "top", text: "R1 Shadow mode is blocked: 1 of 4 criteria met, recall 86% against the 88% gate.", tip: "Decide the recall threshold before Sep 30.", action: { label: "View release", proj: "ima", tab: "roadmap" }, widget: { type: "release", proj: "ima", rid: "R1" } },
      { group: "top", text: "Gates across the portfolio.", tip: null, action: { label: "Nowhere", proj: "nope", tab: "value" }, widget: { type: "table", columns: ["Milestone", "Metric", "Now", "Base"], rows: [["MS-21", "Rule recall", "86%", "88%"], ["MS-13", "Extraction accuracy", "81%", "85%"]] } },
      { group: "fyi", text: "Something about a milestone that does not exist, worth 99999 points.", tip: null, action: { label: "Review proposals", proj: "inbox", tab: "overview" }, widget: { type: "gates", proj: "ima", mid: "MS-99" } },
      { group: "elsewhere", text: "Nothing to see.", tip: "", action: null, widget: { type: "none" } },
    ],
  });

const appWith = (llm: Llm | null, autoCurate = false) => {
  const db = openDb(":memory:");
  seed(db);
  const app = createApp(db, { now: () => NOW, llm, autoJudge: false, autoCurate });
  const call = async <T>(method: string, path: string, body?: unknown) => {
    const res = await app.handleApi(new Request(BASE + path, { method, headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }));
    if (!res) throw new Error("not an api route");
    return { status: res.status, body: (await res.json()) as T };
  };
  return { app, db, call };
};

describe("widgets and the composer's own brief", () => {
  test("widgets resolve against live facts and parse only when they point at something real", () => {
    const { db } = appWith(null);
    const state = loadState(db, NOW);
    expect(resolveWidget({ type: "release", proj: "ima", rid: "R1" }, state)?.type).toBe("release");
    const rel = resolveWidget({ type: "release", proj: "ima", rid: "R1" }, state);
    expect(rel?.type === "release" && rel.rows.length).toBe(4);
    expect(resolveWidget({ type: "gates", proj: "ima", mid: "MS-99" }, state)).toBeNull();
    expect(resolveWidget({ type: "metric", proj: "ima", mid: "MS-21", xid: "nope" }, state)).toBeNull();
    expect(resolveWidget({ type: "ci", proj: "onboarding", repo: "doc-ingest-pipeline", number: 409 }, state)?.type).toBe("ci");
    expect(resolveWidget({ type: "proposals", ids: ["prop-1"] }, state)).toBeNull();
    expect(parseWidget({ type: "governance", proj: "ima" }, state)).toEqual({ type: "governance", proj: "ima" });
    expect(parseWidget({ type: "governance", proj: "nope" }, state)).toBeNull();
    expect(parseWidget({ type: "table", columns: ["a"], rows: [["1"]] }, state)).toBeNull();
    expect(parseWidget({ type: "upcoming", days: 500 }, state)).toEqual({ type: "upcoming", days: 90 });
    expect(parseWidget({ type: "bogus" }, state)).toBeNull();
  });

  test("the composer writes its own brief with a widget per signal, and the activity window starts at the last visit", async () => {
    const { db, call } = appWith(null);
    let state = loadState(db, NOW);
    const own = defaultBrief(state);
    expect(own.headline).toMatch(/^One release is blocked/);
    expect(own.sections.map((s) => `${s.group}:${s.widget?.type ?? "none"}`)).toEqual(["top:release", "top:gates", "top:none", "top:none", "fyi:upcoming", "fyi:activity"]);
    expect(own.sections[0]?.text).toMatch(/^R1 Shadow mode on IMA compliance rule extraction is blocked/);
    expect(own.sections[0]?.action).toEqual({ label: "View release", proj: "ima", tab: "roadmap" });
    expect(own.sections[0]?.tip).toMatch(/^Unmet: /);
    expect(own.sections.every((s) => !s.widget || resolveWidget(s.widget, state))).toBe(true);
    const blocks = composeGlance(state, calendarOf(state));
    expect(blocks.find((b) => b.kind === "activity")?.title).toBe("Since yesterday");
    const seen = await call<Workspace>("POST", routes.glanceSeen());
    expect(seen.status).toBe(200);
    expect(seen.body.lastGlanceAt).toBe(NOW.toISOString());
    state = loadState(db, NOW);
    expect(composeGlance(state, calendarOf(state)).find((b) => b.kind === "activity")?.title).toMatch(/^Since you last looked/);
    expect(defaultBrief(state).sections.at(-1)?.text).toContain("since you last looked");
  });
});

describe("curator", () => {
  test("title-case headlines become sentence case, keeping ids, acronyms, and project names", () => {
    expect(sentenceCase("R1 Blocked: IMA CI Fails, 6 Proposals Pending", ["IMA compliance rule extraction"])).toBe("R1 blocked: IMA CI fails, 6 proposals pending");
    expect(sentenceCase("Sector Report Generation Lacks Three Governance Items", ["Sector report generation"])).toBe("Sector report generation lacks three governance items");
    expect(sentenceCase("R1 is blocked on recall; nothing else needs you today")).toBe("R1 is blocked on recall; nothing else needs you today");
  });

  test("the curator keeps sections, drops widgets that point nowhere, scores widget validity and grounding, and stores pointers", async () => {
    const llm = fakeLlm(curatorReply);
    const { db, call } = appWith(llm);
    const curator = loadState(db, NOW).agents.find((a) => a.kind === "curator")!;
    const ctx = curatorContext(loadState(db, NOW), composeGlance(loadState(db, NOW), calendarOf(loadState(db, NOW))));
    expect(ctx).toContain("Reader: Al McKay (AM)");
    expect(ctx).toContain("- blocked_release:ima:R1 [blocked_release");
    expect(ctx).toContain('proj "ima"');
    expect(ctx).toContain("MS-21 (metrics:");
    const run = await curateGlance(db, llm, curator, NOW);
    expect(run.state).toBe("done");
    expect(run.proj).toBeNull();
    expect(run.summary).toBe("R1 is blocked on recall; nothing else needs you today");
    expect(run.output).toContain("## Top of mind");
    expect(run.output).toContain("→ View release");
    expect(run.output).toContain("[widget: release ima/R1]");
    expect(run.output).toContain("| MS-21 | Rule recall | 86% | 88% |");
    const state = (await call<AppState>("GET", routes.state())).body;
    expect(state.brief?.runId).toBe(run.id);
    expect(state.brief?.sections.map((s) => [s.group, s.widget?.type ?? null, s.action?.label ?? null, s.tip])).toEqual([
      ["top", "release", "View release", "Decide the recall threshold before Sep 30."],
      ["top", "table", null, null],
      ["fyi", null, "Review proposals", null],
      ["top", null, null, null],
    ]);
    const scores = db.query<{ dimension: string; score: number; note: string }, [string]>("SELECT dimension, score, note FROM run_scores WHERE run_id = ? AND scorer = 'rules' ORDER BY dimension").all(run.id);
    expect(scores.find((s) => s.dimension === "widgets_valid")?.score).toBeCloseTo(2 / 3);
    const grounding = scores.find((s) => s.dimension === "grounding");
    expect(grounding?.score).toBeLessThan(1);
    expect(grounding?.note).toContain("99999");
    expect(briefIsCurrent(state)).toBe(true);
    expect(state.brief?.stateHash).toBe(blocksHash(composeGlance(state, calendarOf(state))));
  });

  test("the curate route returns the run and brief; a bad reply stores nothing; the benchmark runs the curator without replacing the brief", async () => {
    const llm = fakeLlm((m) => (m[0]?.content.includes("daily brief") ? curatorReply() : JSON.stringify({ groundedness: 8, completeness: 8, actionability: 8, clarity: 8, unsupported: [], expectations: [], critique: "ok" })));
    const { db, call } = appWith(llm);
    const res = await call<{ run: AgentRun; brief: DailyBrief | null }>("POST", routes.glanceCurate());
    expect(res.status).toBe(200);
    expect(res.body.brief?.runId).toBe(res.body.run.id);

    const bad = fakeLlm(() => JSON.stringify({ headline: "", sections: [] }));
    const curator = loadState(db, NOW).agents.find((a) => a.kind === "curator")!;
    const failed = await curateGlance(db, bad, curator, NOW);
    expect(failed.state).toBe("failed");
    expect(loadState(db, NOW).brief?.runId).toBe(res.body.run.id);

    const runs = await runBenchmark(db, llm, NOW, "curator");
    expect(runs.map((r) => [r.agentId, r.benchmark, r.state])).toEqual([["curator", "curator-morning", "done"]]);
    expect(loadState(db, NOW).brief?.runId).toBe(res.body.run.id);
  });

  test("auto-curation runs once in the background when the brief is missing or stale, not on every load", async () => {
    let calls = 0;
    const llm = fakeLlm(() => {
      calls += 1;
      return curatorReply();
    });
    const { call } = appWith(llm, true);
    await call("GET", routes.state());
    await call("GET", routes.state());
    await new Promise((r) => setTimeout(r, 30));
    const s1 = (await call<AppState>("GET", routes.state())).body;
    expect(calls).toBe(1);
    expect(s1.brief).not.toBeNull();
    await call("POST", routes.glanceSeen());
    await call("GET", routes.state());
    await new Promise((r) => setTimeout(r, 30));
    // A visit changes the activity title but no fact, so no rewrite.
    expect(calls).toBe(1);
  });
});
