// ================= calendar =================
//
// Milestones and releases are planned by month. Months are real (`YYYY-MM`),
// "today" comes from the clock the server reports in `AppState.asOf`, and the
// axis every chart draws is derived: a window around today widened to include
// every planned month. Nothing about the calendar is stored.

import type { AppState } from "./types.ts";

/** A month as `YYYY-MM`. Lexical order is chronological order. */
export type YearMonth = string;

export const YEAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
export const isYearMonth = (s: string): s is YearMonth => YEAR_MONTH.test(s);

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

const split = (ym: YearMonth): [number, number] => {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  return [Number.isFinite(y) ? y : 1970, Number.isFinite(m) && m >= 1 && m <= 12 ? m : 1];
};

const join = (y: number, m: number): YearMonth => `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`;

/** The month a date falls in (UTC). */
export const ymOf = (d: Date | string): YearMonth => {
  const date = typeof d === "string" ? new Date(d) : d;
  return join(date.getUTCFullYear(), date.getUTCMonth() + 1);
};

export const addMonths = (ym: YearMonth, n: number): YearMonth => {
  const [y, m] = split(ym);
  const total = y * 12 + (m - 1) + n;
  return join(Math.floor(total / 12), (total % 12) + 1);
};

/** Signed number of months from `a` to `b`. */
export const monthsBetween = (a: YearMonth, b: YearMonth): number => {
  const [ay, am] = split(a);
  const [by, bm] = split(b);
  return by * 12 + bm - (ay * 12 + am);
};

/** "Sep" in the current year, "Jan '27" otherwise. */
export const monthLabel = (ym: YearMonth, todayYm: YearMonth): string => {
  const [y, m] = split(ym);
  const name = MONTH_NAMES[m - 1] ?? ym;
  return y === split(todayYm)[0] ? name : `${name} '${String(y).slice(2)}`;
};

/** "Thursday, Sep 10" for the page header. */
export const dayLabel = (asOf: string): string =>
  new Date(asOf).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });

export interface Calendar {
  /** Consecutive months on the axis, earliest first. */
  months: YearMonth[];
  /** Index of the current month within `months`. */
  today: number;
  todayYm: YearMonth;
  /** ISO timestamp the calendar was built for. */
  asOf: string;
}

/** How far the axis extends around today before data widens it. */
export const MONTHS_BACK = 8;
export const MONTHS_AHEAD = 6;

/** Axis around `asOf`, widened so every anchor month (planned milestone or release) is on it. */
export const calendarFor = (asOf: Date | string, anchors: readonly YearMonth[] = [], back = MONTHS_BACK, ahead = MONTHS_AHEAD): Calendar => {
  const iso = typeof asOf === "string" ? asOf : asOf.toISOString();
  const todayYm = ymOf(iso);
  let first = addMonths(todayYm, -back);
  let last = addMonths(todayYm, ahead);
  for (const a of anchors) {
    if (!isYearMonth(a)) continue;
    if (a < first) first = a;
    if (a > last) last = a;
  }
  const months: YearMonth[] = [];
  for (let ym = first; ym <= last; ym = addMonths(ym, 1)) months.push(ym);
  return { months, today: monthsBetween(first, todayYm), todayYm, asOf: iso };
};

/** Every planned month in the state, for widening the axis. */
export const plannedMonths = (state: Pick<AppState, "projects" | "releases">): YearMonth[] => [
  ...state.projects.flatMap((p) => p.milestones.map((m) => m.month)),
  ...Object.values(state.releases).flatMap((rs) => rs.map((r) => r.month)),
];

export const calendarOf = (state: Pick<AppState, "projects" | "releases" | "asOf">): Calendar => calendarFor(state.asOf, plannedMonths(state));

/** Position of a month on the axis; months outside the window clamp to its ends. */
export const monthIndex = (cal: Calendar, ym: YearMonth): number => {
  const i = cal.months.indexOf(ym);
  if (i >= 0) return i;
  const first = cal.months[0];
  return first !== undefined && ym < first ? 0 : cal.months.length - 1;
};

/** Months offered when planning: the axis plus a year beyond it. */
export const planningMonths = (cal: Calendar, extra = 12): YearMonth[] => {
  const last = cal.months[cal.months.length - 1] ?? cal.todayYm;
  const out = [...cal.months];
  for (let i = 1; i <= extra; i++) out.push(addMonths(last, i));
  return out;
};
