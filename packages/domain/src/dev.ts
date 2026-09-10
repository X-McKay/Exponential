// ================= development activity (derived) =================
//
// Repo stats, pull requests, builds, and daily commit counts are facts
// synced from source control and CI. Everything a page shows about them —
// the KPI tiles, the commit chart, contributor rankings, "3h ago" — is
// derived here from those facts and the clock.

import type { Build, CommitDay, DevFacts, PullRequest, RepoStat, SyncRun, TeamMember } from "./types.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Trailing window the KPI tiles summarise. */
export const STATS_DAYS = 30;
/** Days of commit history the activity chart shows. */
export const ACTIVITY_DAYS = 56;

export const dayOf = (iso: string): string => iso.slice(0, 10);

const addDays = (day: string, n: number): string => new Date(new Date(`${day}T00:00:00Z`).getTime() + n * DAY).toISOString().slice(0, 10);

/** "just now", "3h ago", "2d ago", then a date for anything older than a week. */
export const relTime = (iso: string, asOf: string): string => {
  const ms = new Date(asOf).getTime() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const m = Math.round(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(ms / HOUR);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(ms / DAY);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
};

/** Compact age for table cells: "3h", "1d", "2w". */
export const shortAge = (iso: string, asOf: string): string => {
  const ms = Math.max(0, new Date(asOf).getTime() - new Date(iso).getTime());
  const h = Math.floor(ms / HOUR);
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60_000))}m`;
  if (h < 24) return `${h}h`;
  const d = Math.floor(ms / DAY);
  if (d < 14) return `${d}d`;
  return `${Math.floor(d / 7)}w`;
};

/** "6m 12s", "1h 04m". */
export const durationLabel = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds));
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
};

/** Letter grades from best to worst, for picking the weakest repo. */
const GRADES = ["A+", "A", "A−", "B+", "B", "B−", "C+", "C", "C−", "D", "F"];
const gradeRank = (g: string): number => {
  const i = GRADES.indexOf(g);
  return i < 0 ? GRADES.length : i;
};

export interface DevStats {
  /** Mean coverage across repos that report it, or null when none do. */
  coverage: number | null;
  /** Weakest grade across repos that report one. */
  quality: string | null;
  /** Share of finished CI and deploy builds that passed in the last STATS_DAYS. */
  buildPass: number | null;
  mergedPRs: number;
  /** Median hours from open to merge for PRs merged in the window. */
  medianReviewH: number | null;
  deploys: number;
}

export interface Contributor {
  ini: string;
  name: string;
  commits: number;
  reviews: number;
}

export interface DayCount {
  day: string;
  count: number;
}

export interface DevActivity {
  stats: DevStats;
  repos: RepoStat[];
  /** One entry per day, oldest first, ACTIVITY_DAYS long. */
  days: DayCount[];
  totalCommits: number;
  /** Most recently updated first. */
  prs: PullRequest[];
  /** Most recent first. */
  builds: Build[];
  people: Contributor[];
  lastSync: SyncRun | null;
}

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] ?? null) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
};

const hoursBetween = (a: string, b: string): number => (new Date(b).getTime() - new Date(a).getTime()) / HOUR;

export const deriveDevStats = (facts: Pick<DevFacts, "repos" | "prs" | "builds">, asOf: string): DevStats => {
  const since = new Date(new Date(asOf).getTime() - STATS_DAYS * DAY).toISOString();
  const covs = facts.repos.map((r) => r.coverage).filter((c): c is number => c !== null);
  const grades = facts.repos.map((r) => r.quality).filter((q): q is string => q !== null);
  const merged = facts.prs.filter((pr) => pr.status === "merged" && pr.mergedAt !== null && pr.mergedAt >= since);
  const finished = facts.builds.filter((b) => b.kind !== "eval" && b.status !== "running" && b.startedAt >= since);
  return {
    coverage: covs.length ? Math.round(covs.reduce((a, b) => a + b, 0) / covs.length) : null,
    quality: grades.length ? grades.reduce((worst, g) => (gradeRank(g) > gradeRank(worst) ? g : worst)) : null,
    buildPass: finished.length ? Math.round((100 * finished.filter((b) => b.status === "pass").length) / finished.length) : null,
    mergedPRs: merged.length,
    medianReviewH: median(merged.map((pr) => hoursBetween(pr.openedAt, pr.mergedAt ?? pr.openedAt))),
    deploys: facts.builds.filter((b) => b.kind === "deploy" && b.status === "pass" && b.startedAt >= since).length,
  };
};

/** Daily commit totals for the trailing window, oldest first, with zero-filled gaps. */
export const commitDays = (commits: CommitDay[], asOf: string, days = ACTIVITY_DAYS): DayCount[] => {
  const today = dayOf(asOf);
  const first = addDays(today, -(days - 1));
  const totals = new Map<string, number>();
  for (const c of commits) if (c.day >= first && c.day <= today) totals.set(c.day, (totals.get(c.day) ?? 0) + c.count);
  return Array.from({ length: days }, (_, i) => {
    const day = addDays(first, i);
    return { day, count: totals.get(day) ?? 0 };
  });
};

export const contributors = (facts: Pick<DevFacts, "commits" | "prs">, team: TeamMember[], asOf: string): Contributor[] => {
  const since = new Date(new Date(asOf).getTime() - STATS_DAYS * DAY).toISOString();
  const sinceDay = dayOf(since);
  const byIni = new Map<string, Contributor>();
  const get = (ini: string): Contributor => {
    let c = byIni.get(ini);
    if (!c) {
      c = { ini, name: team.find((t) => t.ini === ini)?.name ?? ini, commits: 0, reviews: 0 };
      byIni.set(ini, c);
    }
    return c;
  };
  for (const c of facts.commits) if (c.day >= sinceDay) get(c.author).commits += c.count;
  for (const pr of facts.prs) if (pr.updatedAt >= since) for (const r of pr.reviewers) get(r).reviews += 1;
  return [...byIni.values()].filter((c) => c.commits > 0 || c.reviews > 0).sort((a, b) => b.commits + b.reviews - (a.commits + a.reviews));
};

export const deriveDev = (facts: DevFacts, team: TeamMember[], asOf: string): DevActivity => {
  const days = commitDays(facts.commits, asOf);
  return {
    stats: deriveDevStats(facts, asOf),
    repos: [...facts.repos].sort((a, b) => a.repo.localeCompare(b.repo)),
    days,
    totalCommits: days.reduce((a, d) => a + d.count, 0),
    prs: [...facts.prs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    builds: [...facts.builds].sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    people: contributors(facts, team, asOf),
    lastSync: facts.lastSync,
  };
};

export const emptyDevFacts = (): DevFacts => ({ repos: [], prs: [], builds: [], commits: [], lastSync: null });

const cmp = (a: string | number, b: string | number): number => (a < b ? -1 : a > b ? 1 : 0);

/** The order facts are stored and returned in (byte-wise, like the database): repos by name, PRs and builds newest first. */
export const sortDevFacts = (f: DevFacts): DevFacts => ({
  ...f,
  repos: [...f.repos].sort((a, b) => cmp(a.repo, b.repo)),
  prs: [...f.prs].sort((a, b) => cmp(b.updatedAt, a.updatedAt) || cmp(a.repo, b.repo) || cmp(a.number, b.number)),
  builds: [...f.builds].sort((a, b) => cmp(b.startedAt, a.startedAt) || cmp(a.repo, b.repo) || cmp(a.id, b.id)),
  commits: [...f.commits].sort((a, b) => cmp(a.repo, b.repo) || cmp(a.day, b.day) || cmp(a.author, b.author)),
});
