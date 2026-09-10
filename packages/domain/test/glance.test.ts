import { describe, expect, test } from "bun:test";
import { composeGlance, composeGlancePage, detectSignals, rankBlocks, seedState, writeNarrative } from "../src/index.ts";
import type { AppState, Block } from "../src/index.ts";

const kinds = (blocks: Block[]): string[] => blocks.map((b) => b.kind);
const find = <K extends Block["kind"]>(blocks: Block[], kind: K): Extract<Block, { kind: K }> | undefined =>
  blocks.find((b): b is Extract<Block, { kind: K }> => b.kind === kind);

describe("detectSignals", () => {
  test("seed state produces the mockup's signals", () => {
    const s = detectSignals(seedState());
    expect(s.blocked.map((x) => `${x.p.id}/${x.r.id}`)).toEqual(["ima/R1"]);
    expect(s.atRisk.map((x) => `${x.p.id}/${x.r.id}`)).toEqual(["onboarding/R2", "sector/R1"]);
    expect(s.readyRel).toEqual([]);
    expect(s.shortfalls.map((x) => `${x.m.id}:${x.gap}`)).toEqual(["MS-31:6", "MS-13:4", "MS-21:2"]);
    expect(s.nearStretch).toEqual([]);
    expect(s.failPRs.map((x) => x.pr.id)).toEqual(["#409"]);
    expect(s.failBuilds.map((x) => x.b.id)).toEqual(["#1148", "#400", "#96"]);
    expect(s.t1gaps.map((p) => p.id)).toEqual(["ima"]);
    expect(s.bestValue?.id).toBe("onboarding");
  });
  test("near-stretch fires only when every below-stretch metric is within 5pts", () => {
    const st = seedState();
    const m12 = st.projects[0]!.milestones.find((m) => m.id === "MS-12")!;
    m12.metrics[0]!.current = 92; // 3 under stretch
    m12.metrics[1]!.current = 91; // 4 under stretch
    expect(detectSignals(st).nearStretch.map((x) => x.m.id)).toEqual(["MS-12"]);
    m12.metrics[1]!.current = 85; // 10 under → not "all close"
    expect(detectSignals(st).nearStretch).toEqual([]);
  });
  test("milestones with zero metrics never produce a shortfall", () => {
    const st = seedState();
    st.projects[0]!.milestones.push({ id: "MS-99", name: "Empty", status: "eval", month: 9, impact: { base: { fte: 1, time: 1 }, stretch: { fte: 2, time: 2 } }, metrics: [] });
    expect(detectSignals(st).shortfalls.some((x) => x.m.id === "MS-99")).toBe(false);
  });
});

describe("rankBlocks / composeGlance", () => {
  test("blocks are sorted by priority and typed by kind", () => {
    const blocks = composeGlance(seedState());
    expect(kinds(blocks)).toEqual([
      "blocked_release",
      "below_gate",
      "below_gate",
      "ci_failing",
      "tier1_gaps",
      "value_trajectory",
      "upcoming",
      "activity",
    ]);
    for (let i = 1; i < blocks.length; i++) expect(blocks[i]!.priority).toBeLessThanOrEqual(blocks[i - 1]!.priority);
  });
  test("blocked release card carries the criteria rows", () => {
    const b = find(composeGlance(seedState()), "blocked_release")!;
    expect(b.title).toBe("R1 Shadow mode — 1/4 go-live criteria met (target Oct)");
    expect(b.span).toBe(2);
    expect(b.tone).toBe("bad");
    expect(b.rows.map((r) => r.eval.ok)).toEqual([false, false, false, true]);
  });
  test("below-gate cards are the two largest shortfalls, closest fix first", () => {
    const blocks = composeGlance(seedState()).filter((b) => b.kind === "below_gate");
    expect(blocks.map((b) => b.title)).toEqual([
      "Document ingestion pipeline needs 4pts to clear base",
      "Draft generation pipeline needs 6pts to clear base",
    ]);
  });
  test("ci_failing card links the PR to its failing build", () => {
    const b = find(composeGlance(seedState()), "ci_failing")!;
    expect(b.pr.id).toBe("#409");
    expect(b.build?.note).toBe("test_ocr_fallback: 3 failures");
  });
  test("tier1_gaps card lists up to three missing items", () => {
    const b = find(composeGlance(seedState()), "tier1_gaps")!;
    expect(b.title).toBe("3 governance items missing on a Tier 1 project");
    expect(b.missing).toEqual(["Product SLA", "UAT process", "User & ops documentation"]);
    expect(b.counts.na).toBe(0);
  });
  test("the signature interaction: dragging a metric across a gate retires and creates cards", () => {
    const st = seedState();
    const ima = st.projects.find((p) => p.id === "ima")!;
    const rec = ima.milestones.find((m) => m.id === "MS-21")!.metrics.find((x) => x.id === "rec")!;
    rec.current = 90;
    let blocks = composeGlance(st);
    // MS-21 no longer a shortfall, R1 still blocked on governance.
    expect(blocks.filter((b) => b.kind === "below_gate").map((b) => b.milestone.id)).toEqual(["MS-13", "MS-31"]);
    expect(find(blocks, "blocked_release")!.rows[0]!.eval.ok).toBe(true);
    ima.governance.forEach((g) => {
      if (g.id === "sec" || g.id === "mra") g.status = "approved";
    });
    blocks = composeGlance(st);
    expect(find(blocks, "blocked_release")).toBeUndefined();
    expect(find(blocks, "ready_release")!.title).toBe("R1 Shadow mode — all go-live criteria met");
  });
  test("empty state still composes without throwing", () => {
    const empty: AppState = { workspace: { user: { name: "You", ini: "ME" } }, projects: [], releases: {}, dev: {}, agents: [], feed: [], upcoming: [] };
    expect(composeGlance(empty)).toEqual([]);
    expect(composeGlancePage(empty).narrative).toEqual(["No releases are currently blocked."]);
  });
});

describe("writeNarrative", () => {
  test("seed narrative matches the mockup wording", () => {
    const page = composeGlancePage(seedState());
    expect(page.narrative).toEqual([
      "One release is blocked — R1 Shadow mode on IMA compliance rule extra… (3 criteria unmet).",
      "The closest fix: analyst quality rating on Draft generation pipeline sits 6pts under its base gate.",
      "3 builds are red, most recently on doc-ingest-pipeline.",
      "Next on the calendar: Sep 14 — pen test window opens (IMA compliance rule extra…).",
    ]);
  });
  test("at-risk wording when nothing is blocked", () => {
    const st = seedState();
    st.projects.find((p) => p.id === "ima")!.governance.forEach((g) => (g.status = "approved"));
    st.projects.find((p) => p.id === "ima")!.milestones[0]!.metrics.forEach((x) => (x.current = 99));
    const s = detectSignals(st);
    expect(writeNarrative(s)[0]).toBe("2 near-term releases are at risk.");
    expect(rankBlocks(s, st).some((b) => b.kind === "ready_release")).toBe(true);
  });
});
