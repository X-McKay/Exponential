import { describe, expect, test } from "bun:test";
import { calendarOf, composeGlance, seedState } from "@valueflow/domain";
import { atRiskReleaseSignals, topAttentionSignals } from "../src/pages/GlancePage.tsx";

describe("Glance attention summary", () => {
  test("surfaces near-term at-risk releases and keeps the summary to three items", () => {
    const state = seedState();
    const cal = calendarOf(state);
    const blocks = composeGlance(state, cal);
    const atRisk = atRiskReleaseSignals(state, cal, blocks);
    const top = topAttentionSignals(blocks, atRisk);

    expect(atRisk.map((x) => `${x.proj}/${x.release.id}`)).toEqual(["invoice/R2", "search/R1"]);
    expect(top).toHaveLength(3);
    expect(top.slice(0, 3).filter((x) => x.kind === "release_attention")).toHaveLength(2);
  });

  test("does not spend a top slot twice on a release and its supporting gate", () => {
    const state = seedState();
    const cal = calendarOf(state);
    const blocks = composeGlance(state, cal);
    const atRisk = atRiskReleaseSignals(state, cal, blocks);
    const top = topAttentionSignals(blocks, atRisk, 10);
    const representedMilestones = new Set(atRisk.flatMap((x) => x.release.milestoneIds.map((id) => `${x.proj}:${id}`)));

    expect(top.filter((x) => x.kind === "below_gate" || x.kind === "near_stretch").some((x) => representedMilestones.has(`${x.proj}:${x.milestone.id}`))).toBe(false);
    expect(new Set(top.map((x) => x.id)).size).toBe(top.length);
  });
});
