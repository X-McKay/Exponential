// ================= derived state =================
//
// Invariant: value is never stored. It is always derived from milestone
// status + metric readings against gates; release readiness is always derived
// from live criteria references. Nothing in this module has side effects.

import { addMonths } from "./calendar.ts";
import type { Calendar } from "./calendar.ts";
import { GSTATUS_LABEL } from "./labels.ts";
import type {
  Criterion,
  Dim,
  GateTier,
  GovernanceItem,
  Metric,
  Milestone,
  Project,
  Release,
} from "./types.ts";

/** Milestones whose gate metrics are being measured. */
export const isMeasurable = (m: Pick<Milestone, "status">): boolean => {
  switch (m.status) {
    case "eval":
    case "shipped":
      return true;
    case "backlog":
    case "progress":
      return false;
  }
};

/** Where a single metric sits relative to its gates. */
export type MetricLevel = "below" | "base" | "stretch";
export const metricLevel = (x: Pick<Metric, "current" | "base" | "stretch">): MetricLevel =>
  x.current >= x.stretch ? "stretch" : x.current >= x.base ? "base" : "below";

/**
 * Gate tier a milestone has cleared. Unmeasured milestones (backlog / in
 * progress) are always tier 0. A milestone with no metrics can never clear a
 * gate: `[].every(...)` would be vacuously true, so guard it explicitly.
 */
export const tierOf = (m: Milestone): GateTier => {
  if (!isMeasurable(m)) return 0;
  if (m.metrics.length === 0) return 0;
  // A zero value with no recorded reading is unknown, even when a gate is
  // configured at zero. Legacy in-memory fixtures omit readAt and remain
  // supported; server state uses null to mean no evidence exists.
  const measured = (x: Metric): boolean => x.readAt !== null;
  if (m.metrics.every((x) => measured(x) && x.current >= x.stretch)) return 2;
  if (m.metrics.every((x) => measured(x) && x.current >= x.base)) return 1;
  return 0;
};

/** Impact a milestone contributes on a dimension given the tier it has cleared. */
export const impactOf = (m: Milestone, d: Dim): number => {
  const t = tierOf(m);
  switch (t) {
    case 2:
      return m.impact.stretch[d];
    case 1:
      return m.impact.base[d];
    case 0:
      return 0;
  }
};

/** Value realized = shipped milestones' gated impact, summed. */
/** Value eligible after a shipped milestone clears its configured gate.
 * This is delivery eligibility, not an observed business outcome. */
export const eligible = (p: Pick<Project, "milestones">, d: Dim): number =>
  p.milestones.reduce((a, m) => a + (m.status === "shipped" ? impactOf(m, d) : 0), 0);

/** @deprecated Use eligible; no observed-benefit fact is stored yet. */
export const realized = eligible;

/** Fraction of a milestone's stretch gates attained, averaged (0 when it has no metrics). */
export const attainment = (m: Pick<Milestone, "metrics">): number =>
  m.metrics.length
    ? m.metrics.reduce((a, x) => a + (x.stretch > 0 ? Math.min(x.current / x.stretch, 1) : 0), 0) / m.metrics.length
    : 0;

/** Governance readiness: approved / required items. N/A items are excluded; no items → 0. */
export const readiness = (p: Pick<Project, "governance">): number => {
  const items = p.governance.filter((g) => g.status !== "na");
  if (items.length === 0) return 0;
  return items.filter((g) => g.status === "approved").length / items.length;
};

export const blockers = (p: Pick<Project, "governance">): number =>
  p.governance.filter((g) => g.status === "missing").length;

export const govCounts = (p: Pick<Project, "governance">): Record<GovernanceItem["status"], number> => {
  const c: Record<GovernanceItem["status"], number> = { approved: 0, in_review: 0, draft: 0, missing: 0, na: 0 };
  for (const g of p.governance) c[g.status] += 1;
  return c;
};

export const shippedCount = (p: Pick<Project, "milestones">): number =>
  p.milestones.filter((m) => m.status === "shipped").length;

// ---- releases -----------------------------------------------------------

export interface CriterionEval {
  ok: boolean;
  pending: boolean;
  sub: string;
}

/**
 * Evaluate one go-live criterion against live project state. A criterion that
 * references a deleted milestone or an untracked governance item resolves to
 * not-met (never throws).
 */
export const evalCriterion = (c: Criterion, p: Pick<Project, "milestones" | "governance">): CriterionEval => {
  switch (c.type) {
    case "gate": {
      const m = p.milestones.find((x) => x.id === c.ms);
      if (!m) return { ok: false, pending: false, sub: "milestone not found" };
      const measurable = isMeasurable(m);
      return {
        ok: tierOf(m) >= 1,
        pending: !measurable,
        sub: measurable ? m.metrics.map((x) => `${x.label} ${x.current}%`).join(" · ") : "no eval data yet",
      };
    }
    case "gov": {
      const g = p.governance.find((x) => x.id === c.gid);
      if (!g) return { ok: false, pending: false, sub: "not tracked" };
      const ok = g.status === "approved" || g.status === "na";
      const pending = g.status === "in_review" || g.status === "draft";
      return { ok, pending, sub: `${GSTATUS_LABEL[g.status]}${g.date ? " · " + g.date : ""}` };
    }
    case "manual":
      return { ok: c.ok, pending: false, sub: c.ok ? "Confirmed" : "Not confirmed" };
  }
};

export type ReleaseLabel = "Shipped" | "Ready" | "Blocked" | "At risk" | "Not configured";
export type ReleaseTone = "good" | "warn" | "bad";

export interface ReleaseState {
  evals: CriterionEval[];
  met: number;
  total: number;
  tone: ReleaseTone;
  label: ReleaseLabel;
}

/** Evaluate a release against live state as of the calendar's today. */
export const releaseState = (rel: Release, p: Pick<Project, "milestones" | "governance">, cal: Pick<Calendar, "todayYm">): ReleaseState => {
  const evals = rel.criteria.map((c) => evalCriterion(c, p));
  const met = evals.filter((e) => e.ok).length;
  const total = rel.criteria.length;
  const allMet = total > 0 && met === total;
  const tone: ReleaseTone = total === 0 ? "warn" : allMet ? "good" : met >= total / 2 ? "warn" : "bad";
  // A planned month and passing gates establish readiness only. Shipment is a
  // separate deployment fact and is therefore never inferred here.
  const label: ReleaseLabel = total === 0 ? "Not configured" : allMet ? "Ready" : rel.month <= addMonths(cal.todayYm, 1) ? "Blocked" : "At risk";
  return { evals, met, total, tone, label };
};

export const nextRelease = (releases: Release[], cal: Pick<Calendar, "todayYm">): Release | undefined =>
  releases.filter((r) => r.month > cal.todayYm).sort((a, b) => a.month.localeCompare(b.month))[0];

// ---- time series --------------------------------------------------------

export interface BurnupSeries {
  /** Eligible value per month; flat after today. Null means historical evidence is unknown. */
  real: (number | null)[];
  /** Committed (base gates) per month from today onward; null before today. */
  com: (number | null)[];
  /** Stretch ceiling per month; historical values are null without snapshots. */
  ceil: (number | null)[];
}

/** One value per month on the calendar axis. */
export const burnupSeries = (milestones: Milestone[], dim: Dim, cal: Calendar, historicalMilestones: Milestone[] = []): BurnupSeries => {
  const { months, today, todayYm } = cal;
  // Retired milestones contribute only to historical points. Keeping them in
  // a separate argument preserves current eligibility and committed totals.
  const historicalPool = [...milestones, ...historicalMilestones];
  const archivedIds = new Set(historicalMilestones.map((m) => m.id));
  // undefined means historical evidence is unknown; null means the milestone
  // did not exist yet and therefore contributes a known zero.
  const snapshotAt = (m: Milestone, ym: string): Milestone | null | undefined => {
    // A month's historical value includes evidence recorded on any day in
    // that month, so the cutoff is the final instant before the next month.
    const at = new Date(`${addMonths(ym, 1)}-01T00:00:00.000Z`).getTime() - 1;
    const snapshots = m.snapshots
      ?.filter((s) => new Date(s.at).getTime() <= at)
      .sort((a, b) => a.at.localeCompare(b.at) || (a.seq ?? 0) - (b.seq ?? 0));
    const s = snapshots?.at(-1);
    if (s) return { ...m, status: s.status, month: s.month, impact: s.impact, metrics: s.metrics };
    return m.createdAt && new Date(m.createdAt).getTime() > at ? null : undefined;
  };
  const real: (number | null)[] = months.map((ym) => {
    let value = 0;
    for (const m of historicalPool) {
      if (ym >= todayYm && archivedIds.has(m.id)) continue;
      // There is no honest zero for a pre-upgrade milestone without a
      // timestamped snapshot: its historical contribution is unknown.
      const historical = ym < todayYm ? snapshotAt(m, ym) : m;
      if (historical === undefined) return null;
      if (historical === null) continue;
      if (historical.status === "shipped" && historical.month <= (ym < todayYm ? ym : todayYm)) value += impactOf(historical, dim);
    }
    return value;
  });
  const realToday = real[today] ?? 0;
  const com = months.map((ym, t) => {
    if (t < today) return null;
    return realToday + milestones.reduce((a, m) => a + (m.status !== "shipped" && m.month <= ym ? m.impact.base[dim] : 0), 0);
  });
  const ceil: (number | null)[] = months.map((ym) => {
    let value = 0;
    for (const m of historicalPool) {
      if (ym >= todayYm && archivedIds.has(m.id)) continue;
      const historical = ym < todayYm ? snapshotAt(m, ym) : m;
      if (historical === undefined) return null;
      if (historical === null) continue;
      if (historical.month <= ym) value += historical.impact.stretch[dim];
    }
    return value;
  });
  return { real, com, ceil };
};

// ---- ids ----------------------------------------------------------------

const numberIn = (id: string): number => parseInt((id.match(/\d+/) ?? ["0"])[0] ?? "0", 10);

/** Next milestone id in a project: MS-<max existing number + 1>. */
export const nextMilestoneId = (p: Pick<Project, "milestones">): string => `MS-${Math.max(0, ...p.milestones.map((m) => numberIn(m.id))) + 1}`;

/** Next release id in a project: R<max existing number + 1>. */
export const nextReleaseId = (releases: Pick<Release, "id">[]): string => `R${Math.max(0, ...releases.map((r) => numberIn(r.id))) + 1}`;

/** Next project key across the portfolio: PRJ-<max existing number + 1>. */
export const nextProjectKey = (projects: Pick<Project, "key">[]): string => `PRJ-${Math.max(0, ...projects.map((p) => numberIn(p.key))) + 1}`;

/**
 * URL-safe id derived from a name ("Client onboarding" → "client-onboarding"),
 * suffixed with -2, -3… until it is not in `taken`. Falls back to `fallback`
 * when the name has no usable characters.
 */
export const slugId = (name: string, taken: Iterable<string>, fallback = "item"): string => {
  const base =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || fallback;
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
};

/** Initials for a person's name: "Dan K." → "DK", "R. Singh" → "RS", one word → first two letters. */
export const initialsOf = (name: string): string => {
  const words = name
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  const first = words[0] ?? "";
  if (words.length === 1) return first.slice(0, 2).toUpperCase();
  return words
    .slice(0, 3)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();
};
