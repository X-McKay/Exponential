// ================= feed and calendar (derived) =================
//
// The activity feed is derived from `events`: an append-only log written
// when facts change (a sync finds a merged PR or a failed build, an eval
// records a reading, a milestone ships, a governance item moves). The
// "Coming up" list is derived from user-entered calendar events plus the
// target months of releases that have not shipped.

import { monthLabel } from "./calendar.ts";
import type { Calendar } from "./calendar.ts";
import { releaseState } from "./derive.ts";
import type { AppState, DevFacts, Event, FeedType, ProjectTab } from "./types.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** How much event history the state carries. */
export const EVENT_WINDOW_DAYS = 60;

export interface FeedItem {
  at: string;
  type: FeedType;
  proj: string;
  tab: ProjectTab;
  text: string;
}

export interface FeedDay {
  day: string;
  items: FeedItem[];
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Newest first, then by ref: the order the database returns. */
export const sortEvents = (events: Event[]): Event[] => [...events].sort((a, b) => cmp(b.at, a.at) || cmp(a.ref, b.ref));

export const recentEvents = (events: Event[], asOf: string, hours = 48): Event[] => {
  const since = new Date(new Date(asOf).getTime() - hours * HOUR).toISOString();
  return sortEvents(events.filter((e) => e.at >= since && e.at <= asOf));
};

/** "Sep 14" (UTC). */
export const dateLabel = (iso: string): string => new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** Group events into the buckets the mockup used: Today, Yesterday, Earlier this week, Earlier. */
export const feedDays = (events: Event[], asOf: string): FeedDay[] => {
  const today = asOf.slice(0, 10);
  const yesterday = new Date(new Date(`${today}T00:00:00Z`).getTime() - DAY).toISOString().slice(0, 10);
  const weekAgo = new Date(new Date(`${today}T00:00:00Z`).getTime() - 6 * DAY).toISOString().slice(0, 10);
  const buckets: FeedDay[] = [
    { day: "Today", items: [] },
    { day: "Yesterday", items: [] },
    { day: "Earlier this week", items: [] },
    { day: "Earlier", items: [] },
  ];
  for (const e of sortEvents(events)) {
    const d = e.at.slice(0, 10);
    const i = d >= today ? 0 : d === yesterday ? 1 : d >= weekAgo ? 2 : 3;
    buckets[i]?.items.push({ at: e.at, type: e.type, proj: e.proj, tab: e.tab, text: e.text });
  }
  return buckets.filter((b) => b.items.length > 0);
};

// ---- calendar ------------------------------------------------------------

export interface Upcoming {
  /** Display label: "Sep 14" for dated events, "Oct" for release targets. */
  date: string;
  /** Sort key: YYYY-MM-DD. */
  at: string;
  proj: string;
  tab: ProjectTab;
  text: string;
  sub: string | null;
  release?: { pid: string; rid: string };
}

/** Dated calendar events from today on, merged with unshipped releases' target months. */
export const deriveUpcoming = (state: Pick<AppState, "calendar" | "releases" | "projects">, cal: Calendar, limit = 8): Upcoming[] => {
  const today = cal.asOf.slice(0, 10);
  const items: Upcoming[] = state.calendar
    .filter((c) => c.date >= today)
    .map((c) => ({ date: dateLabel(c.date), at: c.date, proj: c.proj, tab: c.tab, text: c.text, sub: c.sub }));
  for (const p of state.projects) {
    for (const r of state.releases[p.id] ?? []) {
      if (r.month < cal.todayYm) continue;
      if (releaseState(r, p, cal).label === "Shipped") continue;
      items.push({ date: monthLabel(r.month, cal.todayYm), at: `${r.month}-01`, proj: p.id, tab: "roadmap", text: `${r.id} · ${r.name} target`, sub: null, release: { pid: p.id, rid: r.id } });
    }
  }
  return items.sort((a, b) => cmp(a.at, b.at) || (a.release ? 1 : 0) - (b.release ? 1 : 0) || cmp(a.text, b.text)).slice(0, limit);
};

// ---- events from development facts ---------------------------------------

/** Feed entries a sync produces: merged and opened PRs, failed builds, deploys, and eval runs in the trailing window. */
export const deriveDevEvents = (pid: string, facts: Pick<DevFacts, "prs" | "builds">, asOf: string, windowDays = 7): Event[] => {
  const since = new Date(new Date(asOf).getTime() - windowDays * DAY).toISOString();
  const out: Event[] = [];
  for (const pr of facts.prs) {
    if (pr.status === "merged" && pr.mergedAt && pr.mergedAt >= since)
      out.push({ ref: `pr:${pr.repo}#${pr.number}:merged`, at: pr.mergedAt, type: "merge", proj: pid, tab: "development", text: `PR #${pr.number} merged: ${pr.title} (${pr.author})` });
    if (pr.status === "open" && pr.openedAt >= since)
      out.push({ ref: `pr:${pr.repo}#${pr.number}:opened`, at: pr.openedAt, type: "merge", proj: pid, tab: "development", text: `PR #${pr.number} opened: ${pr.title} (${pr.author})` });
  }
  for (const b of facts.builds) {
    if (b.startedAt < since) continue;
    if (b.status === "fail") out.push({ ref: `build:${b.repo}/${b.id}`, at: b.startedAt, type: "build", proj: pid, tab: "development", text: `Build ${b.id} failed on ${b.repo} ${b.branch} — ${b.note}` });
    else if (b.kind === "deploy" && b.status === "pass") out.push({ ref: `deploy:${b.repo}/${b.id}`, at: b.startedAt, type: "deploy", proj: pid, tab: "development", text: `${b.repo}: ${b.note} (build ${b.id})` });
    else if (b.kind === "eval" && b.status === "pass") out.push({ ref: `eval:${b.repo}/${b.id}`, at: b.startedAt, type: "eval", proj: pid, tab: "value", text: `${b.repo}: ${b.note} (build ${b.id})` });
  }
  return out;
};
