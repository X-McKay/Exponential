import { describe, expect, test } from "bun:test";
import { calendarOf, seedState } from "@valueflow/domain";
import type { Release } from "@valueflow/domain";
import { focusRelease, releaseBlockers } from "../src/releaseFocus.ts";
import { HOME, parseHash, toHash } from "../src/router.ts";

const state = seedState();
const cal = calendarOf(state);
const project = state.projects.find((p) => p.id === "clauses")!;
const release = state.releases.clauses![0]!;

describe("release attention and destinations", () => {
  test("prioritizes unfinished past targets without mutating release order", () => {
    const ready: Release = { ...release, id: "ready", month: "2026-07", criteria: [{ type: "manual", label: "Confirmed", ok: true }] };
    const late: Release = { ...release, id: "late", month: "2026-08" };
    const future: Release = { ...release, id: "future", month: "2026-11" };
    const releases = [future, ready, late];
    expect(focusRelease(releases, project, cal)?.id).toBe("late");
    expect(releases.map((r) => r.id)).toEqual(["future", "ready", "late"]);
    expect(focusRelease([ready, future], project, cal)?.id).toBe("future");
    expect(focusRelease([], project, cal)).toBeUndefined();
  });

  test("routes unmet criteria to referenced items and leaves met items out", () => {
    const blockers = releaseBlockers(release, project, cal);
    expect(blockers.some((b) => b.tab === "value" && b.focusId === "MS-21")).toBe(true);
    expect(blockers.some((b) => b.tab === "governance" && b.focusId === "sec" && b.owner)).toBe(true);
    expect(blockers.every((b) => !b.evaluation.ok)).toBe(true);
  });

  test("manual and missing references lead to release criteria, not guessed destinations", () => {
    const broken: Release = { ...release, criteria: [{ type: "gate", ms: "missing", label: "Broken" }, { type: "manual", ok: false, label: "Sign-off" }] };
    expect(releaseBlockers(broken, project, cal).map((b) => [b.tab, b.focusId, b.label])).toEqual([
      ["roadmap", release.id, "Fix criterion reference"],
      ["roadmap", release.id, "Review criterion"],
    ]);
  });
});

describe("deep links", () => {
  test("round-trips project and target identifiers including reserved characters", () => {
    const view = { ...HOME, page: "project" as const, projectId: "project / 1", tab: "governance" as const, focusId: "review/#1" };
    expect(parseHash(toHash(view))).toEqual(view);
    expect(parseHash("#/project/ima/value/MS-21").focusId).toBe("MS-21");
  });
  test("existing links remain valid and malformed encoding does not crash routing", () => {
    expect(toHash(parseHash("#/project/ima/roadmap"))).toBe("#/project/ima/roadmap");
    expect(() => parseHash("#/project/%ZZ/governance/%GG")).not.toThrow();
  });
});
