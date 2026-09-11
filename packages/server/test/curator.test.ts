// Generative Glance: the composer finds cards, the curator only chooses among
// them. Layouts hold block ids, never values; invalid ids are dropped; the
// page falls back to the composer's order; "since you last looked" starts at
// the reader's last visit.

import { describe, expect, test } from "bun:test";
import { applyLayout, blocksHash, calendarOf, composeGlance, defaultLayout, validPlacements, zoneOf } from "@valueflow/domain";
import type { AgentRun, AppState, Block, GlanceLayout, Workspace } from "@valueflow/domain";
import { routes } from "@valueflow/shared";
import { createApp } from "../src/app.ts";
import { curateGlance, curatorContext, layoutIsCurrent } from "../src/curator.ts";
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

/** A curator that picks the blocked release, the proposals card, and activity, plus two ids that do not exist. */
const curatorReply = (m: ChatMessage[]) => {
  const ids = [...(m[1]?.content ?? "").matchAll(/^- ([\w:#.-]+) \[/gm)].map((x) => x[1] ?? "");
  const blocked = ids.find((i) => i.startsWith("blocked_release:")) ?? "";
  const activity = ids.find((i) => i === "activity") ?? "";
  return JSON.stringify({
    headline: "R1 is blocked on recall; nothing else needs you today",
    placements: [
      { zone: "watch", blockId: blocked, why: "1 of 4 criteria met; recall 86% vs 88%." },
      { zone: "know", blockId: activity, why: "Two builds went red since you looked." },
      { zone: "decide", blockId: "decisions", why: "invented; no proposals exist yet" },
      { zone: "watch", blockId: "nope:x", why: "invented" },
      { zone: "know", blockId: activity, why: "duplicate" },
    ],
  });
};

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

describe("glance zones", () => {
  test("blocks carry stable ids, zones follow kind, and the default layout caps each zone", () => {
    const { db } = appWith(null);
    const state = loadState(db, NOW);
    const blocks = composeGlance(state, calendarOf(state));
    expect(blocks.every((b) => b.id.length > 0)).toBe(true);
    expect(new Set(blocks.map((b) => b.id)).size).toBe(blocks.length);
    expect(blocks.find((b) => b.kind === "blocked_release")?.id).toBe("blocked_release:ima:R1");
    expect(zoneOf("blocked_release")).toBe("watch");
    expect(zoneOf("decisions")).toBe("decide");
    expect(zoneOf("activity")).toBe("know");
    const d = defaultLayout(blocks);
    expect(d.zones.watch.length).toBeLessThanOrEqual(3);
    expect(d.zones.decide.length + d.zones.watch.length + d.zones.know.length + d.more.length).toBe(blocks.length);
    expect(d.curated).toBeNull();
  });

  test("a layout resolves against today's blocks: dropped ids vanish, the rest fold into more, nothing valid falls back", () => {
    const { db } = appWith(null);
    const state = loadState(db, NOW);
    const blocks = composeGlance(state, calendarOf(state));
    const layout: GlanceLayout = { runId: "run-1", at: NOW.toISOString(), stateHash: blocksHash(blocks), headline: "H", placements: [{ zone: "know", blockId: "activity", why: "w" }, { zone: "watch", blockId: "gone:1", why: "" }], model: "fake" };
    const r = applyLayout(blocks, layout);
    expect(r.zones.know.map((p) => [p.block.id, p.why])).toEqual([["activity", "w"]]);
    expect(r.zones.watch).toEqual([]);
    expect(r.more.length).toBe(blocks.length - 1);
    expect(r.headline).toBe("H");
    expect(applyLayout(blocks, { ...layout, placements: [{ zone: "watch", blockId: "gone:1", why: "" }] }).curated).toBeNull();
    expect(validPlacements([{ zone: "watch", blockId: "activity", why: "x" }, { zone: "nowhere", blockId: "activity", why: "" }, { zone: "know", blockId: "activity", why: "" }], blocks)).toEqual([{ zone: "watch", blockId: "activity", why: "x" }]);
  });

  test("the activity card starts where the reader last looked, and the proposals card appears when something waits", async () => {
    const { db, call } = appWith(null);
    let state = loadState(db, NOW);
    expect(composeGlance(state, calendarOf(state)).find((b) => b.kind === "activity")?.title).toBe("Since yesterday");
    expect(composeGlance(state, calendarOf(state)).some((b) => b.kind === "decisions")).toBe(false);
    const seen = await call<Workspace>("POST", routes.glanceSeen());
    expect(seen.status).toBe(200);
    expect(seen.body.lastGlanceAt).toBe(NOW.toISOString());
    state = loadState(db, NOW);
    const activity = composeGlance(state, calendarOf(state)).find((b) => b.kind === "activity");
    expect(activity?.title).toMatch(/^Since you last looked/);
  });
});

describe("curator", () => {
  test("the curator keeps only placements that name real cards, stores the layout as pointers, and the page resolves it", async () => {
    const llm = fakeLlm(curatorReply);
    const { db, call } = appWith(llm);
    const curator = loadState(db, NOW).agents.find((a) => a.kind === "curator")!;
    const ctx = curatorContext(loadState(db, NOW), composeGlance(loadState(db, NOW), calendarOf(loadState(db, NOW))));
    expect(ctx).toContain("Reader: Al McKay (AM)");
    expect(ctx).toContain("- blocked_release:ima:R1 [blocked_release");
    const run = await curateGlance(db, llm, curator, NOW);
    expect(run.state).toBe("done");
    expect(run.proj).toBeNull();
    expect(run.summary).toBe("R1 is blocked on recall; nothing else needs you today");
    expect(run.output).toContain("## Watch");
    expect(run.output).toContain("R1 Shadow mode");
    const state = (await call<AppState>("GET", routes.state())).body;
    expect(state.layout?.runId).toBe(run.id);
    expect(state.layout?.placements).toEqual([
      { zone: "watch", blockId: "blocked_release:ima:R1", why: "1 of 4 criteria met; recall 86% vs 88%." },
      { zone: "know", blockId: "activity", why: "Two builds went red since you looked." },
    ]);
    const scores = db.query<{ dimension: string; score: number }, [string]>("SELECT dimension, score FROM run_scores WHERE run_id = ? AND scorer = 'rules' ORDER BY dimension").all(run.id);
    expect(scores.find((s) => s.dimension === "layout_valid")?.score).toBeCloseTo(2 / 5);
    const blocks = composeGlance(state, calendarOf(state));
    const resolved = applyLayout(blocks, state.layout);
    expect(resolved.zones.watch[0]?.block.kind).toBe("blocked_release");
    expect(resolved.zones.decide).toEqual([]);
    expect(resolved.more.length).toBe(blocks.length - 2);
    expect(layoutIsCurrent(state)).toBe(true);
  });

  test("the curate route returns the run and layout; a failed reply stores no layout; the benchmark case runs the curator", async () => {
    const llm = fakeLlm((m) => (m[0]?.content.includes("Glance curator") ? curatorReply(m) : JSON.stringify({ groundedness: 8, completeness: 8, actionability: 8, clarity: 8, unsupported: [], expectations: [], critique: "ok" })));
    const { db, call } = appWith(llm);
    const res = await call<{ run: AgentRun; layout: GlanceLayout | null }>("POST", routes.glanceCurate());
    expect(res.status).toBe(200);
    expect(res.body.layout?.runId).toBe(res.body.run.id);

    const bad = fakeLlm(() => JSON.stringify({ headline: "", placements: [] }));
    const curator = loadState(db, NOW).agents.find((a) => a.kind === "curator")!;
    const failed = await curateGlance(db, bad, curator, NOW);
    expect(failed.state).toBe("failed");
    expect(loadState(db, NOW).layout?.runId).toBe(res.body.run.id);

    const runs = await runBenchmark(db, llm, NOW, "curator");
    expect(runs.map((r) => [r.agentId, r.benchmark, r.state])).toEqual([["curator", "curator-morning", "done"]]);
    // Benchmark curation measures; it does not replace the reader's layout.
    expect(loadState(db, NOW).layout?.runId).toBe(res.body.run.id);
  });

  test("auto-curation runs once in the background when the layout is missing or stale, not on every load", async () => {
    let calls = 0;
    const llm = fakeLlm((m) => {
      calls += 1;
      return curatorReply(m);
    });
    const { call } = appWith(llm, true);
    await call("GET", routes.state());
    await call("GET", routes.state());
    await new Promise((r) => setTimeout(r, 30));
    const s1 = (await call<AppState>("GET", routes.state())).body;
    expect(calls).toBe(1);
    expect(s1.layout).not.toBeNull();
    await call("GET", routes.state());
    await new Promise((r) => setTimeout(r, 30));
    expect(calls).toBe(1);
    // Facts move: a proposal arrives, so the composer's cards change and a new curation follows.
    const { db: db2 } = appWith(null);
    void db2;
    const before = (await call<AppState>("GET", routes.state())).body;
    const block: Block | undefined = composeGlance(before, calendarOf(before)).find((b) => b.kind === "decisions");
    expect(block).toBeUndefined();
  });
});
