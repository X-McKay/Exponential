import { describe, expect, test } from "bun:test";
import { seedState } from "@valueflow/domain";
import { roadmapReleaseRows } from "../src/charts/RoadmapTimeline.tsx";

describe("roadmap release lanes", () => {
  test("groups release milestones into one lane and preserves unassigned targets", () => {
    const state = seedState();
    const project = state.projects.find((candidate) => candidate.id === "onboarding")!;
    const releases = state.releases.onboarding!;
    const { rows, unassigned } = roadmapReleaseRows(project, releases);

    expect(rows.map((row) => row.release.name)).toEqual(["Mapping GA", "Ingestion GA", "Full auto-reconciliation"]);
    expect(rows[0]!.milestones.map((milestone) => milestone.id)).toEqual(["MS-15", "MS-12"]);
    expect(rows[0]!.start).toBe("2026-05-15");
    expect(rows[0]!.end).toBe("2026-08-15");
    expect(unassigned.map((milestone) => milestone.id)).toEqual(["MS-16"]);
  });
});
