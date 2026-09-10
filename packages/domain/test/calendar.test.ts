import { describe, expect, test } from "bun:test";
import { addMonths, calendarFor, calendarOf, dayLabel, monthIndex, monthLabel, monthsBetween, planningMonths, seedState, ymOf } from "../src/index.ts";

describe("year-month arithmetic", () => {
  test("ymOf uses UTC and addMonths wraps years", () => {
    expect(ymOf("2026-09-10T09:00:00Z")).toBe("2026-09");
    expect(ymOf(new Date("2026-12-31T23:30:00Z"))).toBe("2026-12");
    expect(addMonths("2026-09", 4)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-09", 0)).toBe("2026-09");
    expect(monthsBetween("2026-09", "2027-02")).toBe(5);
    expect(monthsBetween("2027-02", "2026-09")).toBe(-5);
  });
  test("labels show the year only when it differs from today's", () => {
    expect(monthLabel("2026-09", "2026-09")).toBe("Sep");
    expect(monthLabel("2027-01", "2026-09")).toBe("Jan '27");
    expect(monthLabel("2025-12", "2026-09")).toBe("Dec '25");
    expect(dayLabel("2026-09-10T09:00:00Z")).toBe("Thursday, Sep 10");
  });
});

describe("calendarFor", () => {
  test("default window is 8 months back and 6 ahead of today", () => {
    const cal = calendarFor("2026-09-10T09:00:00Z");
    expect(cal.months[0]).toBe("2026-01");
    expect(cal.months.at(-1)).toBe("2027-03");
    expect(cal.months.length).toBe(15);
    expect(cal.today).toBe(8);
    expect(cal.todayYm).toBe("2026-09");
  });
  test("anchors widen the window in either direction; junk anchors are ignored", () => {
    const cal = calendarFor("2026-09-10T09:00:00Z", ["2025-06", "2027-08", "nope"]);
    expect(cal.months[0]).toBe("2025-06");
    expect(cal.months.at(-1)).toBe("2027-08");
    expect(cal.today).toBe(15);
  });
  test("the fixtures' calendar matches the mockup axis, and months outside the window clamp", () => {
    const cal = calendarOf(seedState());
    expect(cal.months.length).toBe(15);
    expect(monthIndex(cal, "2026-09")).toBe(8);
    expect(monthIndex(cal, "2020-01")).toBe(0);
    expect(monthIndex(cal, "2030-01")).toBe(14);
    expect(planningMonths(cal).length).toBe(27);
  });
  test("the same fixtures a year later still put today on the axis", () => {
    const cal = calendarOf({ ...seedState(), asOf: "2027-09-10T09:00:00Z" });
    expect(cal.months[0]).toBe("2026-05");
    expect(cal.todayYm).toBe("2027-09");
    expect(cal.months.at(-1)).toBe("2028-03");
  });
});
