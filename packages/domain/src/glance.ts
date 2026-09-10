// ================= Glance: composition contract =================
//
// The Glance page is generated, never authored. It is composed in three
// replaceable stages behind a single data contract:
//
//   detectSignals(state)  → Signals        (deterministic detectors)
//   rankBlocks(signals)   → Block[]        (priority ranker; LLM-replaceable)
//   writeNarrative(signals) → string[]     (narrative writer; LLM-replaceable)
//
// `composeGlance` wires them together. Blocks carry only data — no markup —
// so the client renders each `kind` with an exhaustive switch.

import { addMonths, calendarOf, monthLabel } from "./calendar.ts";
import type { Calendar } from "./calendar.ts";
import { blockers, govCounts, isMeasurable, metricLevel, realized, releaseState, tierOf } from "./derive.ts";
import type { CriterionEval, ReleaseState } from "./derive.ts";
import type {
  AppState,
  Build,
  Dim,
  FeedItem,
  GovStatus,
  Metric,
  Milestone,
  Project,
  ProjectTab,
  PullRequest,
  Release,
  Upcoming,
} from "./types.ts";

export type Tone = "bad" | "warn" | "good" | "info";

interface BlockBase {
  /** Priority; higher sorts first. */
  priority: number;
  span: 1 | 2;
  tone: Tone;
  tag: string;
  /** Project the card navigates to (null for portfolio-wide cards navigates to `proj` anyway). */
  proj: string;
  tab: ProjectTab;
  projName: string | null;
  title: string;
}

export interface CriterionRow {
  label: string;
  eval: CriterionEval;
}

export type Block =
  | (BlockBase & { kind: "blocked_release"; release: Release; state: ReleaseState; rows: CriterionRow[] })
  | (BlockBase & { kind: "below_gate"; milestone: Milestone; gap: number; metrics: Metric[] })
  | (BlockBase & { kind: "ci_failing"; pr: PullRequest; build: Build | null })
  | (BlockBase & { kind: "tier1_gaps"; counts: Record<GovStatus, number>; missing: string[] })
  | (BlockBase & { kind: "near_stretch"; milestone: Milestone; metrics: Metric[]; fteUpside: number })
  | (BlockBase & { kind: "value_trajectory"; milestones: Milestone[]; dim: Dim; target: number; realized: number })
  | (BlockBase & { kind: "ready_release"; release: Release })
  | (BlockBase & { kind: "upcoming"; items: Upcoming[] })
  | (BlockBase & { kind: "activity"; items: FeedItem[] });

export type BlockKind = Block["kind"];

// ---- signals ------------------------------------------------------------

export interface ReleaseSignal {
  p: Project;
  r: Release;
  st: ReleaseState;
}
export interface ShortfallSignal {
  p: Project;
  m: Milestone;
  gap: number;
  worst: Metric;
}
export interface NearStretchSignal {
  p: Project;
  m: Milestone;
  close: Metric[];
}
export interface FailingPr {
  pid: string;
  pr: PullRequest;
}
export interface FailingBuild {
  pid: string;
  b: Build;
}

export interface Signals {
  blocked: ReleaseSignal[];
  atRisk: ReleaseSignal[];
  readyRel: ReleaseSignal[];
  shortfalls: ShortfallSignal[];
  nearStretch: NearStretchSignal[];
  failPRs: FailingPr[];
  failBuilds: FailingBuild[];
  t1gaps: Project[];
  bestValue: Project | null;
  upcoming: Upcoming[];
  recent: FeedItem[];
  projectCount: number;
  cal: Calendar;
}

export const shortName = (p: Pick<Project, "name">): string => (p.name.length > 26 ? p.name.slice(0, 25) + "…" : p.name);

export const detectSignals = (state: AppState, cal: Calendar = calendarOf(state)): Signals => {
  const blocked: ReleaseSignal[] = [];
  const atRisk: ReleaseSignal[] = [];
  const readyRel: ReleaseSignal[] = [];
  const shortfalls: ShortfallSignal[] = [];
  const nearStretch: NearStretchSignal[] = [];

  for (const p of state.projects) {
    for (const r of state.releases[p.id] ?? []) {
      const st = releaseState(r, p, cal);
      switch (st.label) {
        case "Blocked":
          blocked.push({ p, r, st });
          break;
        case "At risk":
          if (r.month <= addMonths(cal.todayYm, 2)) atRisk.push({ p, r, st });
          break;
        case "Ready":
          readyRel.push({ p, r, st });
          break;
        case "Shipped":
          break;
      }
    }
    for (const m of p.milestones) {
      if (!isMeasurable(m) || m.metrics.length === 0) continue;
      const t = tierOf(m);
      if (t === 0) {
        let worst: Metric | null = null;
        let gap = -Infinity;
        for (const x of m.metrics) {
          const g = x.base - x.current;
          if (g > gap) {
            gap = g;
            worst = x;
          }
        }
        if (worst) shortfalls.push({ p, m, gap, worst });
      } else if (t === 1) {
        const below = m.metrics.filter((x) => metricLevel(x) !== "stretch");
        const close = below.filter((x) => x.stretch - x.current <= 5);
        if (below.length > 0 && close.length === below.length) nearStretch.push({ p, m, close });
      }
    }
  }
  shortfalls.sort((a, b) => b.gap - a.gap);

  const failPRs: FailingPr[] = [];
  const failBuilds: FailingBuild[] = [];
  for (const [pid, d] of Object.entries(state.dev)) {
    for (const pr of d.prs) if (pr.checks === "fail") failPRs.push({ pid, pr });
    for (const b of d.builds) if (b.status === "fail") failBuilds.push({ pid, b });
  }

  const t1gaps = state.projects.filter((p) => p.tier === 1 && blockers(p) > 0);
  const ratio = (p: Project): number => (p.targets.fte > 0 ? realized(p, "fte") / p.targets.fte : 0);
  const bestValue = [...state.projects].sort((a, b) => ratio(b) - ratio(a))[0] ?? null;

  const recent = [...(state.feed[0]?.items ?? []), ...(state.feed[1]?.items ?? [])];

  return {
    blocked,
    atRisk,
    readyRel,
    shortfalls,
    nearStretch,
    failPRs,
    failBuilds,
    t1gaps,
    bestValue,
    upcoming: state.upcoming,
    recent,
    projectCount: state.projects.length,
    cal,
  };
};

// ---- narrative ----------------------------------------------------------

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

export const writeNarrative = (s: Signals): string[] => {
  const sents: string[] = [];
  if (s.blocked.length) {
    sents.push(
      `${s.blocked.length === 1 ? "One release is blocked" : s.blocked.length + " releases are blocked"} — ${s.blocked
        .map(({ p, r, st }) => `${r.id} ${r.name} on ${shortName(p)} (${st.total - st.met} criteria unmet)`)
        .join("; ")}.`,
    );
  } else if (s.atRisk.length) {
    sents.push(`${s.atRisk.length} near-term release${plural(s.atRisk.length, " is", "s are")} at risk.`);
  } else {
    sents.push("No releases are currently blocked.");
  }
  const sf = s.shortfalls[0];
  if (sf) sents.push(`The closest fix: ${sf.worst.label.toLowerCase()} on ${sf.m.name} sits ${sf.gap}pt${plural(sf.gap, "", "s")} under its base gate.`);
  const ns = s.nearStretch[0];
  if (ns) sents.push(`Upside: ${ns.m.name} is within ${Math.max(...ns.close.map((x) => x.stretch - x.current))}pts of its stretch gate.`);
  const fb = s.failBuilds[0];
  if (fb) sents.push(`${s.failBuilds.length} build${plural(s.failBuilds.length, " is", "s are")} red, most recently on ${fb.b.repo}.`);
  const nextUp = s.upcoming[0];
  if (nextUp) {
    const projName = nextUp.proj;
    sents.push(`Next on the calendar: ${nextUp.date} — ${nextUp.text.toLowerCase()} (${projName}).`);
  }
  return sents;
};

/** Narrative with project ids resolved to short names (needs the project list). */
export const writeNarrativeFor = (state: AppState, s: Signals): string[] => {
  const byId = new Map(state.projects.map((p) => [p.id, p]));
  return writeNarrative({
    ...s,
    upcoming: s.upcoming.map((u) => {
      const p = byId.get(u.proj);
      return p ? { ...u, proj: shortName(p) } : u;
    }),
  });
};

// ---- ranker -------------------------------------------------------------

export const rankBlocks = (s: Signals, state: AppState): Block[] => {
  const byId = new Map(state.projects.map((p) => [p.id, p]));
  const short = (pid: string): string | null => {
    const p = byId.get(pid);
    return p ? shortName(p) : null;
  };
  const blocks: Block[] = [];

  for (const { p, r, st } of s.blocked) {
    blocks.push({
      kind: "blocked_release",
      priority: 100,
      span: 2,
      tone: "bad",
      tag: "Blocking release",
      proj: p.id,
      tab: "roadmap",
      projName: shortName(p),
      title: `${r.id} ${r.name} — ${st.met}/${st.total} go-live criteria met (target ${monthLabel(r.month, s.cal.todayYm)})`,
      release: r,
      state: st,
      rows: r.criteria.map((c, i) => ({ label: c.label, eval: st.evals[i] ?? { ok: false, pending: false, sub: "" } })),
    });
  }

  for (const { p, m, gap } of s.shortfalls.slice(0, 2)) {
    blocks.push({
      kind: "below_gate",
      priority: 90 - gap * 0.1,
      span: 1,
      tone: "warn",
      tag: "Below gate",
      proj: p.id,
      tab: "value",
      projName: shortName(p),
      title: `${m.name} needs ${gap}pt${plural(gap, "", "s")} to clear base`,
      milestone: m,
      gap,
      metrics: m.metrics,
    });
  }

  for (const { pid, pr } of s.failPRs.slice(0, 1)) {
    const fb = s.failBuilds.find((f) => f.b.branch.includes(pr.id.replace("#", "")));
    blocks.push({
      kind: "ci_failing",
      priority: 80,
      span: 1,
      tone: "warn",
      tag: "CI failing",
      proj: pid,
      tab: "development",
      projName: short(pid),
      title: `${pr.id} — ${pr.title}`,
      pr,
      build: fb ? fb.b : null,
    });
  }

  for (const p of s.t1gaps) {
    const n = blockers(p);
    blocks.push({
      kind: "tier1_gaps",
      priority: 75,
      span: 1,
      tone: "bad",
      tag: "Tier 1 gaps",
      proj: p.id,
      tab: "governance",
      projName: shortName(p),
      title: `${n} governance item${plural(n, "", "s")} missing on a Tier 1 project`,
      counts: govCounts(p),
      missing: p.governance.filter((g) => g.status === "missing").slice(0, 3).map((g) => g.name),
    });
  }

  for (const { p, m, close } of s.nearStretch.slice(0, 1)) {
    blocks.push({
      kind: "near_stretch",
      priority: 62,
      span: 1,
      tone: "good",
      tag: "Stretch within reach",
      proj: p.id,
      tab: "value",
      projName: shortName(p),
      title: `${m.name}: +${m.impact.stretch.fte - m.impact.base.fte}% FTE on the table`,
      milestone: m,
      metrics: close,
      fteUpside: m.impact.stretch.fte - m.impact.base.fte,
    });
  }

  if (s.bestValue) {
    const p = s.bestValue;
    blocks.push({
      kind: "value_trajectory",
      priority: 55,
      span: 1,
      tone: "info",
      tag: "Value trajectory",
      proj: p.id,
      tab: "value",
      projName: shortName(p),
      title: `${realized(p, "fte")}% of ${p.targets.fte}% FTE target realized`,
      milestones: p.milestones,
      dim: "fte",
      target: p.targets.fte,
      realized: realized(p, "fte"),
    });
  }

  for (const { p, r } of s.readyRel.slice(0, 1)) {
    blocks.push({
      kind: "ready_release",
      priority: 52,
      span: 1,
      tone: "good",
      tag: "Ready to ship",
      proj: p.id,
      tab: "roadmap",
      projName: shortName(p),
      title: `${r.id} ${r.name} — all go-live criteria met`,
      release: r,
    });
  }

  const up0 = s.upcoming[0];
  if (up0) {
    blocks.push({
      kind: "upcoming",
      priority: 50,
      span: 1,
      tone: "info",
      tag: "Coming up",
      proj: up0.proj,
      tab: up0.tab,
      projName: null,
      title: "Next 8 weeks",
      items: s.upcoming.slice(0, 4),
    });
  }

  const rec0 = s.recent[0];
  if (rec0) {
    blocks.push({
      kind: "activity",
      priority: 45,
      span: 2,
      tone: "info",
      tag: "Recent activity",
      proj: rec0.proj,
      tab: rec0.tab,
      projName: null,
      title: "Since yesterday",
      items: s.recent.slice(0, 5),
    });
  }

  return blocks.sort((a, b) => b.priority - a.priority);
};

// ---- composition --------------------------------------------------------

export interface Glance {
  narrative: string[];
  blocks: Block[];
  projectCount: number;
}

/** The single entry point: full state in, ranked typed blocks out. */
export const composeGlance = (state: AppState, cal: Calendar = calendarOf(state)): Block[] => rankBlocks(detectSignals(state, cal), state);

/** Blocks plus narrative, for the page header. */
export const composeGlancePage = (state: AppState, cal: Calendar = calendarOf(state)): Glance => {
  const s = detectSignals(state, cal);
  return { narrative: writeNarrativeFor(state, s), blocks: rankBlocks(s, state), projectCount: state.projects.length };
};
