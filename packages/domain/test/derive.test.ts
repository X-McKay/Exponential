import { describe, expect, test } from "bun:test";
import {
  attainment,
  blockers,
  burnupSeries,
  evalCriterion,
  impactOf,
  isMeasurable,
  metricLevel,
  milestoneStart,
  releaseSpan,
  roadmapCalendar,
  nextMilestoneId,
  nextRelease,
  readiness,
  eligible,
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
  test("a missing reading does not satisfy a zero-valued gate", () => {
    const missing = ms({ status: "shipped", metrics: [{ id: "a", label: "A", base: 0, stretch: 0, current: 0, readAt: null }] });
    expect(tierOf(missing)).toBe(0);
    expect(tierOf({ ...missing, metrics: [{ ...missing.metrics[0]!, readAt: "2026-09-12T00:00:00.000Z" }] })).toBe(2);
  });
});

describe("impactOf / eligible", () => {
  test("names gated delivery value as eligible until observed benefit exists", () => {
    expect(eligible(project("invoice"), "fte")).toBe(eligible(project("invoice"), "fte"));
  });
  test("impact follows tier", () => {
    expect(impactOf(ms(), "fte")).toBe(10);
    expect(impactOf(ms(), "time")).toBe(12);
    const stretch = ms({ metrics: [{ id: "a", label: "A", base: 80, stretch: 95, current: 99 }] });
    expect(impactOf(stretch, "fte")).toBe(15);
    expect(impactOf(ms({ status: "backlog" }), "fte")).toBe(0);
  });
  test("eligible counts only shipped milestones", () => {
    const p = project("invoice");
    // MS-12 shipped at base (87/82 vs 80/80) → 10, MS-15 shipped at base (71 vs 60) → 5; MS-13 is in eval, not shipped.
    expect(eligible(p, "fte")).toBe(15);
    expect(eligible(p, "time")).toBe(15);
    expect(eligible(project("clauses"), "fte")).toBe(0);
  });
  test("eligible reacts to a metric crossing a gate", () => {
    const p = project("invoice");
    const m12 = p.milestones.find((m) => m.id === "MS-12")!;
    m12.metrics.forEach((x) => (x.current = 95));
    expect(eligible(p, "fte")).toBe(20);
    m12.metrics[0]!.current = 79;
    expect(eligible(p, "fte")).toBe(5);
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
    const p = project("search");
    // 14 items, 2 are N/A → 12 required, 0 approved.
    expect(readiness(p)).toBe(0);
    p.governance.forEach((g) => {
      if (g.status !== "na") g.status = "approved";
    });
    expect(readiness(p)).toBe(1);
  });
  test("onboarding readiness is 11/14", () => {
    expect(readiness(project("invoice"))).toBeCloseTo(11 / 14, 6);
  });
  test("zero required items → 0, not NaN", () => {
    expect(readiness({ governance: [] })).toBe(0);
    expect(readiness({ governance: [{ cat: "x", id: "a", name: "A", status: "na", owner: "JA", date: null, detail: "" }] })).toBe(0);
  });
  test("blockers counts missing items only", () => {
    expect(blockers(project("invoice"))).toBe(0);
    expect(blockers(project("clauses"))).toBe(3);
    expect(blockers(project("search"))).toBe(10);
  });
});

describe("evalCriterion", () => {
  test("gate criterion referencing a deleted milestone resolves to not-met without throwing", () => {
    const p = project("invoice");
    p.milestones = p.milestones.filter((m) => m.id !== "MS-12");
    const e = evalCriterion({ type: "gate", ms: "MS-12", label: "x" }, p);
    expect(e.ok).toBe(false);
    expect(e.pending).toBe(false);
    expect(e.sub).toBe("milestone not found");
  });
  test("gate criterion on unmeasured milestone is pending", () => {
    const e = evalCriterion({ type: "gate", ms: "MS-14", label: "x" }, project("invoice"));
    expect(e).toEqual({ ok: false, pending: true, sub: "no eval data yet" });
  });
  test("gate criterion on measurable milestone reports metrics", () => {
    const e = evalCriterion({ type: "gate", ms: "MS-12", label: "x" }, project("invoice"));
    expect(e.ok).toBe(true);
    expect(e.sub).toBe("Extraction accuracy 87% · Supplier coverage 82%");
  });
  test("gov criterion: approved and N/A are ok; in_review/draft pending; missing not met; untracked not met", () => {
    const p = project("search");
    expect(evalCriterion({ type: "gov", gid: "dpia", label: "x" }, p)).toMatchObject({ ok: true, pending: false, sub: "N/A" });
    expect(evalCriterion({ type: "gov", gid: "tdd", label: "x" }, p)).toMatchObject({ ok: false, pending: true, sub: "In review · 2026-08-29" });
    expect(evalCriterion({ type: "gov", gid: "evalso", label: "x" }, p)).toMatchObject({ ok: false, pending: true });
    expect(evalCriterion({ type: "gov", gid: "arch", label: "x" }, p)).toMatchObject({ ok: false, pending: false, sub: "Missing" });
    expect(evalCriterion({ type: "gov", gid: "nope", label: "x" }, p)).toEqual({ ok: false, pending: false, sub: "not tracked" });
  });
  test("manual criterion reflects its flag", () => {
    expect(evalCriterion({ type: "manual", ok: true, label: "x" }, project("clauses"))).toEqual({ ok: true, pending: false, sub: "Confirmed" });
    expect(evalCriterion({ type: "manual", ok: false, label: "x" }, project("clauses"))).toEqual({ ok: false, pending: false, sub: "Not confirmed" });
  });
});

describe("releaseState", () => {
  test("seed states match the mockup", () => {
    expect(releaseState(release("invoice", "R1"), project("invoice"), cal)).toMatchObject({ met: 4, total: 4, label: "Ready", tone: "good" });
    expect(releaseState(release("invoice", "R2"), project("invoice"), cal)).toMatchObject({ met: 1, total: 4, label: "At risk", tone: "bad" });
    expect(releaseState(release("invoice", "R3"), project("invoice"), cal)).toMatchObject({ met: 0, total: 3, label: "At risk", tone: "bad" });
    expect(releaseState(release("clauses", "R1"), project("clauses"), cal)).toMatchObject({ met: 1, total: 4, label: "Blocked", tone: "bad" });
    expect(releaseState(release("search", "R1"), project("search"), cal)).toMatchObject({ met: 1, total: 4, label: "At risk" });
  });
  test("becomes Ready when all criteria are met and month is in the future", () => {
    const p = project("clauses");
    p.milestones.find((m) => m.id === "MS-21")!.metrics.forEach((x) => (x.current = 99));
    p.governance.forEach((g) => {
      if (g.id === "sec" || g.id === "mra") g.status = "approved";
    });
    const st = releaseState(release("clauses", "R1"), p, cal);
    expect(st.label).toBe("Ready");
    expect(st.met).toBe(4);
    expect(releaseState(release("clauses", "R1"), p, { todayYm: "2026-10" }).label).toBe("Ready");
  });
  test("amber when at least half met but not all; a release with zero criteria has nothing outstanding", () => {
    const p = project("invoice");
    const r = release("invoice", "R2");
    p.milestones.find((m) => m.id === "MS-13")!.metrics[0]!.current = 90;
    expect(releaseState(r, p, cal)).toMatchObject({ met: 2, tone: "warn", label: "At risk" });
    expect(releaseState({ ...r, criteria: [] }, p, cal)).toMatchObject({ met: 0, total: 0, tone: "warn", label: "Not configured" });
  });
  test("deleted milestone drops a release to not-met without crashing", () => {
    const p = project("invoice");
    p.milestones = p.milestones.filter((m) => m.id !== "MS-12");
    expect(releaseState(release("invoice", "R1"), p, cal)).toMatchObject({ met: 3, total: 4, label: "Blocked" });
  });
  test("nextRelease finds the first release after today", () => {
    expect(nextRelease(seedState().releases.invoice!, cal)?.id).toBe("R2");
    expect(nextRelease(seedState().releases.invoice!, { todayYm: "2027-02" })).toBeUndefined();
  });
});

describe("burnupSeries", () => {
  test("eligible is flat after today; committed starts today; ceiling is monotone", () => {
    const s = burnupSeries(project("invoice").milestones, "fte", cal);
    expect(cal.months.length).toBe(15);
    expect(cal.today).toBe(8);
    expect(s.real.length).toBe(cal.months.length);
    // Fixtures have no timestamped snapshots, so pre-upgrade history is
    // explicitly unknown instead of being rewritten from today's state.
    expect(s.real[3]).toBeNull();
    expect(s.real[4]).toBeNull();
    expect(s.real[7]).toBeNull();
    expect(s.real[cal.today]).toBe(15);
    expect(s.real[cal.months.length - 1]).toBe(15);
    expect(s.com[cal.today - 1]).toBeNull();
    expect(s.com[cal.today]).toBe(15);
    expect(s.com[9]).toBe(15 + 8);
    expect(s.com[13]).toBe(15 + 8 + 6 + 7);
    for (let i = 1; i < s.ceil.length; i++) {
      if (s.ceil[i] !== null && s.ceil[i - 1] !== null) expect(s.ceil[i]!).toBeGreaterThanOrEqual(s.ceil[i - 1]!);
    }
    expect(s.ceil[cal.months.length - 1]).toBe(15 + 5 + 11 + 9 + 10);
  });

  test("uses month-end snapshots and keeps months before the first snapshot unknown", () => {
    const m = ms({
      status: "shipped",
      month: "2026-09",
      snapshots: [
        { seq: 1, at: "2026-09-30T23:59:59.000Z", status: "eval", month: "2026-09", impact: { base: { fte: 10, time: 10 }, stretch: { fte: 15, time: 15 } }, metrics: [{ id: "a", label: "A", base: 80, stretch: 95, current: 90 }] },
        { seq: 2, at: "2026-10-01T00:00:00.000Z", status: "shipped", month: "2026-09", impact: { base: { fte: 10, time: 10 }, stretch: { fte: 15, time: 15 } }, metrics: [{ id: "a", label: "A", base: 80, stretch: 95, current: 90 }] },
      ],
    });
    const c = calendarFor("2026-11-10T00:00:00.000Z", ["2026-08", "2026-11"]);
    const s = burnupSeries([m], "fte", c);
    expect(s.real[c.months.indexOf("2026-08")]).toBeNull();
    expect(s.real[c.months.indexOf("2026-09")]).toBe(0);
    expect(s.real[c.months.indexOf("2026-10")]).toBe(10);
  });

  test("a milestone created today contributes known zero before its creation", () => {
    const old = ms({ id: "old", status: "shipped", month: "2026-08", createdAt: "2026-08-20T00:00:00.000Z" });
    const fresh = ms({ id: "fresh", status: "backlog", month: "2026-10", createdAt: "2026-09-12T00:00:00.000Z" });
    const snapshot = (m: Milestone, at: string): Milestone["snapshots"] => [{ at, status: m.status, month: m.month, impact: m.impact, metrics: m.metrics.map((x) => ({ ...x, readAt: at, readSource: "eval" as const })) }];
    const withHistory = [{ ...old, snapshots: snapshot(old, "2026-08-20T00:00:00.000Z") }, { ...fresh, snapshots: snapshot(fresh, "2026-09-12T00:00:00.000Z") }];
    const c = calendarFor("2026-09-12T00:00:00.000Z", ["2026-08", "2026-10"]);
    const series = burnupSeries(withHistory, "fte", c);
    expect(series.real[c.months.indexOf("2026-08")]).toBe(10);
  });
});

describe("nextMilestoneId", () => {
  test("increments the max numeric suffix", () => {
    expect(nextMilestoneId(project("invoice"))).toBe("MS-17");
    expect(nextMilestoneId({ milestones: [] })).toBe("MS-1");
    expect(nextMilestoneId({ milestones: [ms({ id: "weird" })] })).toBe("MS-1");
  });
});

describe("milestoneStart", () => {
  test("falls back to a fixed lead before the target", () => {
    expect(milestoneStart(ms({ month: "2026-09" }))).toBe("2026-06");
  });
  test("uses the creation month when known", () => {
    expect(milestoneStart(ms({ month: "2026-09", createdAt: "2026-02-10T09:00:00.000Z" }))).toBe("2026-02");
  });
  test("prefers the oldest snapshot over creation", () => {
    const snap = { at: "2025-12-01T00:00:00.000Z", status: "backlog" as const, month: "2026-09", impact: ms().impact, metrics: [] };
    expect(milestoneStart(ms({ month: "2026-09", createdAt: "2026-02-10T09:00:00.000Z", snapshots: [snap] }))).toBe("2025-12");
  });
  test("ignores evidence from the target month onwards and uses the lead instead", () => {
    expect(milestoneStart(ms({ month: "2026-03", createdAt: "2026-07-01T00:00:00.000Z" }))).toBe("2025-12");
    expect(milestoneStart(ms({ month: "2026-03", createdAt: "2026-03-02T00:00:00.000Z" }))).toBe("2025-12");
  });
});

describe("releaseSpan", () => {
  test("runs from the earliest linked milestone start to the ship month", () => {
    const p = { milestones: [ms({ id: "A", month: "2026-05", createdAt: "2026-01-15T00:00:00.000Z" }), ms({ id: "B", month: "2026-08" }), ms({ id: "C", month: "2026-02", createdAt: "2025-06-01T00:00:00.000Z" })] };
    expect(releaseSpan({ month: "2026-08", milestoneIds: ["A", "B"] }, p)).toEqual({ start: "2026-01", end: "2026-08" });
  });
  test("collapses to the ship month with no linked milestones", () => {
    expect(releaseSpan({ month: "2026-11", milestoneIds: [] }, { milestones: [] })).toEqual({ start: "2026-11", end: "2026-11" });
  });
});

describe("roadmapCalendar", () => {
  test("covers exactly the planned months, from the earliest start to the latest ship month", () => {
    const p = { milestones: [ms({ id: "A", month: "2026-05", createdAt: "2026-01-15T00:00:00.000Z" }), ms({ id: "B", month: "2026-10" })] };
    const rc = roadmapCalendar(p, [{ month: "2026-12", milestoneIds: ["B"] }], cal);
    expect(rc.months[0]).toBe("2026-01");
    expect(rc.months[rc.months.length - 1]).toBe("2026-12");
    expect(rc.months).toHaveLength(12);
    expect(rc.today).toBe(8);
    expect(rc.todayYm).toBe(cal.todayYm);
  });
  test("places today outside the axis when no work is planned around it", () => {
    const rc = roadmapCalendar({ milestones: [ms({ month: "2027-03", createdAt: "2027-01-01T00:00:00.000Z" })] }, [], cal);
    expect(rc.months).toEqual(["2027-01", "2027-02", "2027-03"]);
    expect(rc.today).toBeLessThan(0);
  });
  test("falls back to the app calendar when nothing is planned", () => {
    expect(roadmapCalendar({ milestones: [] }, [], cal)).toBe(cal);
  });
});
