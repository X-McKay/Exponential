import { describe, expect, test } from "bun:test";
import {
  attainment,
  blockers,
  burnupSeries,
  evalCriterion,
  impactOf,
  isMeasurable,
  metricLevel,
  nextMilestoneId,
  nextRelease,
  readiness,
  realized,
  releaseState,
  seedState,
  tierOf,
  calendarFor,
  SEED_ASOF,
} from "../src/index.ts";
import type { Milestone, Project, Release } from "../src/index.ts";

const ms = (over: Partial<Milestone> = {}): Milestone => ({
  id: "MS-1",
  name: "Test",
  status: "eval",
  month: "2026-09",
  impact: { base: { fte: 10, time: 12 }, stretch: { fte: 15, time: 18 } },
  metrics: [
    { id: "a", label: "A", base: 80, stretch: 95, current: 90 },
    { id: "b", label: "B", base: 70, stretch: 90, current: 75 },
  ],
  ...over,
});

/** The fixtures' calendar: today is Sep 2026. */
const cal = calendarFor(SEED_ASOF, ["2026-01", "2027-03"]);

const project = (id: string): Project => {
  const p = seedState().projects.find((x) => x.id === id);
  if (!p) throw new Error(`no project ${id}`);
  return p;
};
const release = (pid: string, rid: string): Release => {
  const r = seedState().releases[pid]?.find((x) => x.id === rid);
  if (!r) throw new Error(`no release ${pid}/${rid}`);
  return r;
};

describe("isMeasurable / metricLevel", () => {
  test("only eval and shipped milestones are measurable", () => {
    expect(isMeasurable({ status: "backlog" })).toBe(false);
    expect(isMeasurable({ status: "progress" })).toBe(false);
    expect(isMeasurable({ status: "eval" })).toBe(true);
    expect(isMeasurable({ status: "shipped" })).toBe(true);
  });
  test("metricLevel is inclusive at the gate", () => {
    expect(metricLevel({ current: 79, base: 80, stretch: 95 })).toBe("below");
    expect(metricLevel({ current: 80, base: 80, stretch: 95 })).toBe("base");
    expect(metricLevel({ current: 95, base: 80, stretch: 95 })).toBe("stretch");
  });
});

describe("tierOf", () => {
  test("unmeasured milestones are tier 0 even with perfect metrics", () => {
    expect(tierOf(ms({ status: "backlog", metrics: [{ id: "a", label: "A", base: 1, stretch: 2, current: 100 }] }))).toBe(0);
    expect(tierOf(ms({ status: "progress", metrics: [{ id: "a", label: "A", base: 1, stretch: 2, current: 100 }] }))).toBe(0);
  });
  test("all metrics ≥ base → tier 1; all ≥ stretch → tier 2; any below base → tier 0", () => {
    expect(tierOf(ms())).toBe(1);
    expect(tierOf(ms({ metrics: [{ id: "a", label: "A", base: 80, stretch: 95, current: 95 }] }))).toBe(2);
    expect(tierOf(ms({ metrics: [{ id: "a", label: "A", base: 80, stretch: 95, current: 96 }, { id: "b", label: "B", base: 70, stretch: 90, current: 69 }] }))).toBe(0);
  });
  test("a measurable milestone with zero metrics can never clear a gate", () => {
    expect(tierOf(ms({ status: "shipped", metrics: [] }))).toBe(0);
    expect(impactOf(ms({ status: "shipped", metrics: [] }), "fte")).toBe(0);
  });
});

describe("impactOf / realized", () => {
  test("impact follows tier", () => {
    expect(impactOf(ms(), "fte")).toBe(10);
    expect(impactOf(ms(), "time")).toBe(12);
    const stretch = ms({ metrics: [{ id: "a", label: "A", base: 80, stretch: 95, current: 99 }] });
    expect(impactOf(stretch, "fte")).toBe(15);
    expect(impactOf(ms({ status: "backlog" }), "fte")).toBe(0);
  });
  test("realized counts only shipped milestones", () => {
    const p = project("onboarding");
    // MS-12 shipped at base (87/82 vs 80/80) → 10, MS-15 shipped at base (71 vs 60) → 5; MS-13 is in eval, not shipped.
    expect(realized(p, "fte")).toBe(15);
    expect(realized(p, "time")).toBe(15);
    expect(realized(project("ima"), "fte")).toBe(0);
  });
  test("realized reacts to a metric crossing a gate", () => {
    const p = project("onboarding");
    const m12 = p.milestones.find((m) => m.id === "MS-12")!;
    m12.metrics.forEach((x) => (x.current = 95));
    expect(realized(p, "fte")).toBe(20);
    m12.metrics[0]!.current = 79;
    expect(realized(p, "fte")).toBe(5);
  });
});

describe("attainment", () => {
  test("averages min(current/stretch, 1) and guards zero metrics", () => {
    expect(attainment({ metrics: [] })).toBe(0);
    expect(attainment({ metrics: [{ id: "a", label: "A", base: 0, stretch: 100, current: 50 }] })).toBe(0.5);
    expect(attainment({ metrics: [{ id: "a", label: "A", base: 0, stretch: 100, current: 250 }] })).toBe(1);
    expect(attainment({ metrics: [{ id: "a", label: "A", base: 0, stretch: 0, current: 10 }] })).toBe(0);
  });
});

describe("readiness / blockers", () => {
  test("N/A items are excluded from readiness", () => {
    const p = project("sector");
    // 14 items, 2 are N/A → 12 required, 0 approved.
    expect(readiness(p)).toBe(0);
    p.governance.forEach((g) => {
      if (g.status !== "na") g.status = "approved";
    });
    expect(readiness(p)).toBe(1);
  });
  test("onboarding readiness is 11/14", () => {
    expect(readiness(project("onboarding"))).toBeCloseTo(11 / 14, 6);
  });
  test("zero required items → 0, not NaN", () => {
    expect(readiness({ governance: [] })).toBe(0);
    expect(readiness({ governance: [{ cat: "x", id: "a", name: "A", status: "na", owner: "AM", date: null, detail: "" }] })).toBe(0);
  });
  test("blockers counts missing items only", () => {
    expect(blockers(project("onboarding"))).toBe(0);
    expect(blockers(project("ima"))).toBe(3);
    expect(blockers(project("sector"))).toBe(10);
  });
});

describe("evalCriterion", () => {
  test("gate criterion referencing a deleted milestone resolves to not-met without throwing", () => {
    const p = project("onboarding");
    p.milestones = p.milestones.filter((m) => m.id !== "MS-12");
    const e = evalCriterion({ type: "gate", ms: "MS-12", label: "x" }, p);
    expect(e.ok).toBe(false);
    expect(e.pending).toBe(false);
    expect(e.sub).toBe("milestone not found");
  });
  test("gate criterion on unmeasured milestone is pending", () => {
    const e = evalCriterion({ type: "gate", ms: "MS-14", label: "x" }, project("onboarding"));
    expect(e).toEqual({ ok: false, pending: true, sub: "no eval data yet" });
  });
  test("gate criterion on measurable milestone reports metrics", () => {
    const e = evalCriterion({ type: "gate", ms: "MS-12", label: "x" }, project("onboarding"));
    expect(e.ok).toBe(true);
    expect(e.sub).toBe("Mapping accuracy 87% · Dataset coverage 82%");
  });
  test("gov criterion: approved and N/A are ok; in_review/draft pending; missing not met; untracked not met", () => {
    const p = project("sector");
    expect(evalCriterion({ type: "gov", gid: "dpia", label: "x" }, p)).toMatchObject({ ok: true, pending: false, sub: "N/A" });
    expect(evalCriterion({ type: "gov", gid: "tdd", label: "x" }, p)).toMatchObject({ ok: false, pending: true, sub: "In review · 2026-08-29" });
    expect(evalCriterion({ type: "gov", gid: "evalso", label: "x" }, p)).toMatchObject({ ok: false, pending: true });
    expect(evalCriterion({ type: "gov", gid: "arch", label: "x" }, p)).toMatchObject({ ok: false, pending: false, sub: "Missing" });
    expect(evalCriterion({ type: "gov", gid: "nope", label: "x" }, p)).toEqual({ ok: false, pending: false, sub: "not tracked" });
  });
  test("manual criterion reflects its flag", () => {
    expect(evalCriterion({ type: "manual", ok: true, label: "x" }, project("ima"))).toEqual({ ok: true, pending: false, sub: "Confirmed" });
    expect(evalCriterion({ type: "manual", ok: false, label: "x" }, project("ima"))).toEqual({ ok: false, pending: false, sub: "Not confirmed" });
  });
});

describe("releaseState", () => {
  test("seed states match the mockup", () => {
    expect(releaseState(release("onboarding", "R1"), project("onboarding"), cal)).toMatchObject({ met: 4, total: 4, label: "Shipped", tone: "good" });
    expect(releaseState(release("onboarding", "R2"), project("onboarding"), cal)).toMatchObject({ met: 1, total: 4, label: "At risk", tone: "bad" });
    expect(releaseState(release("onboarding", "R3"), project("onboarding"), cal)).toMatchObject({ met: 0, total: 3, label: "At risk", tone: "bad" });
    expect(releaseState(release("ima", "R1"), project("ima"), cal)).toMatchObject({ met: 1, total: 4, label: "Blocked", tone: "bad" });
    expect(releaseState(release("sector", "R1"), project("sector"), cal)).toMatchObject({ met: 1, total: 4, label: "At risk" });
  });
  test("becomes Ready when all criteria are met and month is in the future", () => {
    const p = project("ima");
    p.milestones.find((m) => m.id === "MS-21")!.metrics.forEach((x) => (x.current = 99));
    p.governance.forEach((g) => {
      if (g.id === "sec" || g.id === "mra") g.status = "approved";
    });
    const st = releaseState(release("ima", "R1"), p, cal);
    expect(st.label).toBe("Ready");
    expect(st.met).toBe(4);
    expect(releaseState(release("ima", "R1"), p, { todayYm: "2026-10" }).label).toBe("Shipped");
  });
  test("amber when at least half met but not all; a release with zero criteria has nothing outstanding", () => {
    const p = project("onboarding");
    const r = release("onboarding", "R2");
    p.milestones.find((m) => m.id === "MS-13")!.metrics[0]!.current = 90;
    expect(releaseState(r, p, cal)).toMatchObject({ met: 2, tone: "warn", label: "At risk" });
    expect(releaseState({ ...r, criteria: [] }, p, cal)).toMatchObject({ met: 0, total: 0, tone: "good", label: "Ready" });
  });
  test("deleted milestone drops a release to not-met without crashing", () => {
    const p = project("onboarding");
    p.milestones = p.milestones.filter((m) => m.id !== "MS-12");
    expect(releaseState(release("onboarding", "R1"), p, cal)).toMatchObject({ met: 3, total: 4, label: "Blocked" });
  });
  test("nextRelease finds the first release after today", () => {
    expect(nextRelease(seedState().releases.onboarding!, cal)?.id).toBe("R2");
    expect(nextRelease(seedState().releases.onboarding!, { todayYm: "2027-02" })).toBeUndefined();
  });
});

describe("burnupSeries", () => {
  test("realized is flat after today; committed starts today; ceiling is monotone", () => {
    const s = burnupSeries(project("onboarding").milestones, "fte", cal);
    expect(cal.months.length).toBe(15);
    expect(cal.today).toBe(8);
    expect(s.real.length).toBe(cal.months.length);
    expect(s.real[3]).toBe(0);
    expect(s.real[4]).toBe(5);
    expect(s.real[7]).toBe(15);
    expect(s.real[cal.today]).toBe(15);
    expect(s.real[cal.months.length - 1]).toBe(15);
    expect(s.com[cal.today - 1]).toBeNull();
    expect(s.com[cal.today]).toBe(15);
    expect(s.com[9]).toBe(15 + 8);
    expect(s.com[13]).toBe(15 + 8 + 6 + 7);
    for (let i = 1; i < s.ceil.length; i++) expect(s.ceil[i]!).toBeGreaterThanOrEqual(s.ceil[i - 1]!);
    expect(s.ceil[cal.months.length - 1]).toBe(15 + 5 + 11 + 9 + 10);
  });
});

describe("nextMilestoneId", () => {
  test("increments the max numeric suffix", () => {
    expect(nextMilestoneId(project("onboarding"))).toBe("MS-17");
    expect(nextMilestoneId({ milestones: [] })).toBe("MS-1");
    expect(nextMilestoneId({ milestones: [ms({ id: "weird" })] })).toBe("MS-1");
  });
});
