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
import { blockers, govCounts, isMeasurable, metricLevel, eligible, releaseState, tierOf } from "./derive.ts";
import type { CriterionEval, ReleaseState } from "./derive.ts";
import { attentionRuns, latestRunOfKind } from "./agents.ts";
import { deriveUpcoming, recentEvents } from "./feed.ts";
import type { FeedItem, Upcoming } from "./feed.ts";
import { PROJECT_TABS } from "./types.ts";
import { BUDGET_WARN_AT, budgetLabel, budgetLine, fmtTokens, fmtUsd } from "./spend.ts";
import type { BudgetLine } from "./spend.ts";
import type { AgentRun, AppState, BriefAction, BriefSection, Build, Dim, GovStatus, Metric, Milestone, Project, ProjectTab, Proposal, PullRequest, Release, Widget } from "./types.ts";

export type Tone = "bad" | "warn" | "good" | "info";

interface BlockBase {
  /** Stable identity (kind plus the thing it is about) so a layout can point at it. */
  id: string;
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
  | (BlockBase & { kind: "value_trajectory"; milestones: Milestone[]; historicalMilestones?: Milestone[]; dim: Dim; target: number; eligible: number })
  | (BlockBase & { kind: "ready_release"; release: Release })
  | (BlockBase & { kind: "agent_flag"; run: AgentRun; agentName: string })
  | (BlockBase & { kind: "brief"; run: AgentRun; agentName: string })
  | (BlockBase & { kind: "upcoming"; items: Upcoming[]; more: number })
  | (BlockBase & { kind: "activity"; items: FeedItem[]; more: number })
  | (BlockBase & { kind: "decisions"; proposals: Proposal[]; more: number })
  | (BlockBase & { kind: "budget"; line: BudgetLine; name: string });

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
  flags: AgentRun[];
  /** This week's brief, when one has run. */
  brief: AgentRun | null;
  /** Budgets at or past the warning line, most used first. */
  budgets: { line: BudgetLine; name: string }[];
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
        case "Not configured":
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
    for (const pr of [...d.prs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) if (pr.status === "open" && pr.checks === "fail") failPRs.push({ pid, pr });
    for (const b of [...d.builds].sort((x, y) => y.startedAt.localeCompare(x.startedAt))) if (b.status === "fail") failBuilds.push({ pid, b });
  }

  const t1gaps = state.projects.filter((p) => p.tier === 1 && blockers(p) > 0);
  const flags = attentionRuns(state.runs, cal.asOf).filter((r) => state.projects.some((p) => p.id === r.proj));
  const brief = latestRunOfKind("brief", state.agents, state.runs, cal.asOf);
  const ratio = (p: Project): number => (p.targets.fte > 0 ? eligible(p, "fte") / p.targets.fte : 0);
  const bestValue = [...state.projects].sort((a, b) => ratio(b) - ratio(a))[0] ?? null;
  const prices = state.llm?.prices ?? {};
  const budgets = state.budgets
    .map((b) => ({ line: budgetLine(state, prices, b.scope, b.ref), name: b.scope === "workspace" ? "Agent spend" : b.scope === "agent" ? (state.agents.find((a) => a.id === b.ref)?.name ?? b.ref) : (state.projects.find((p) => p.id === b.ref)?.name ?? b.ref) }))
    .filter((x) => x.line.used !== null && x.line.used >= BUDGET_WARN_AT)
    .sort((a, b) => (b.line.used ?? 0) - (a.line.used ?? 0));

  // "Know" starts where the reader left off; without a last visit, the trailing 48 hours.
  const since = state.workspace.lastGlanceAt;
  const window = since ? Math.max(48, Math.min(24 * 14, (new Date(cal.asOf).getTime() - new Date(since).getTime()) / 3_600_000)) : 48;
  const recent: FeedItem[] = recentEvents(state.events, cal.asOf, window)
    .filter((e) => !since || e.at > since || window === 48)
    .map((e) => ({ at: e.at, type: e.type, proj: e.proj, tab: e.tab, text: e.text }));

  return {
    blocked,
    atRisk,
    readyRel,
    shortfalls,
    nearStretch,
    failPRs,
    failBuilds,
    t1gaps,
    flags,
    brief,
    budgets,
    bestValue,
    upcoming: deriveUpcoming(state, cal),
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
      id: `blocked_release:${p.id}:${r.id}`,
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
      id: `below_gate:${p.id}:${m.id}`,
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
    const fb = s.failBuilds.find((f) => f.pid === pid && (f.b.branch.includes(String(pr.number)) || f.b.repo === pr.repo));
    blocks.push({
      id: `ci_failing:${pid}:${pr.repo}#${pr.number}`,
      kind: "ci_failing",
      priority: 80,
      span: 1,
      tone: "warn",
      tag: "CI failing",
      proj: pid,
      tab: "development",
      projName: short(pid),
      title: `#${pr.number} — ${pr.title}`,
      pr,
      build: fb ? fb.b : null,
    });
  }

  for (const p of s.t1gaps) {
    const n = blockers(p);
    blocks.push({
      id: `tier1_gaps:${p.id}`,
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

  if (s.brief) {
    const agent = state.agents.find((a) => a.id === s.brief?.agentId);
    blocks.push({
      id: `brief:${s.brief.id}`,
      kind: "brief",
      priority: 110,
      span: 2,
      tone: "info",
      tag: "Your week",
      proj: s.brief.proj ?? state.projects[0]?.id ?? "",
      tab: "overview",
      projName: null,
      title: s.brief.summary,
      run: s.brief,
      agentName: agent?.name ?? s.brief.agentId,
    });
  }

  for (const run of s.flags.slice(0, 1)) {
    const agent = state.agents.find((a) => a.id === run.agentId);
    blocks.push({
      id: `agent_flag:${run.id}`,
      kind: "agent_flag",
      priority: 70,
      span: 1,
      tone: "warn",
      tag: "Agent flag",
      proj: run.proj ?? "",
      tab: run.tab,
      projName: run.proj ? short(run.proj) : null,
      title: run.summary,
      run,
      agentName: agent?.name ?? run.agentId,
    });
  }

  for (const { line, name } of s.budgets.slice(0, 1)) {
    const spent = line.against === "usd" ? fmtUsd(line.spend.usd ?? 0) : `${fmtTokens(line.spend.tokens)} tokens`;
    blocks.push({
      id: `budget:${line.scope}:${line.ref}`,
      kind: "budget",
      priority: line.state === "over" ? 85 : 68,
      span: 1,
      tone: line.state === "over" ? "bad" : "warn",
      tag: line.state === "over" ? "Budget reached" : "Budget nearly used",
      proj: line.scope === "project" ? line.ref : (state.projects[0]?.id ?? ""),
      tab: "overview",
      projName: line.scope === "project" ? short(line.ref) : null,
      title: `${name}: ${spent} of the ${line.budget ? budgetLabel(line.budget) : ""} monthly budget used (${Math.round((line.used ?? 0) * 100)}%)`,
      line,
      name,
    });
  }

  for (const { p, m, close } of s.nearStretch.slice(0, 1)) {
    blocks.push({
      id: `near_stretch:${p.id}:${m.id}`,
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
      id: `value_trajectory:${p.id}`,
      kind: "value_trajectory",
      priority: 55,
      span: 1,
      tone: "info",
      tag: "Value trajectory",
      proj: p.id,
      tab: "value",
      projName: shortName(p),
      title: `${eligible(p, "fte")}% of ${p.targets.fte}% FTE target eligible`,
      milestones: p.milestones,
      ...(p.historicalMilestones?.length ? { historicalMilestones: p.historicalMilestones } : {}),
      dim: "fte",
      target: p.targets.fte,
      eligible: eligible(p, "fte"),
    });
  }

  for (const { p, r } of s.readyRel.slice(0, 1)) {
    blocks.push({
      id: `ready_release:${p.id}:${r.id}`,
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
      id: "upcoming",
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
      more: Math.max(0, s.upcoming.length - 4),
    });
  }

  const rec0 = s.recent[0];
  if (rec0) {
    blocks.push({
      id: "activity",
      kind: "activity",
      priority: 45,
      span: 2,
      tone: "info",
      tag: "Recent activity",
      proj: rec0.proj,
      tab: rec0.tab,
      projName: null,
      title: state.workspace.lastGlanceAt ? `Since you last looked · ${s.recent.length} event${s.recent.length === 1 ? "" : "s"}` : "Since yesterday",
      items: s.recent.slice(0, 5),
      more: Math.max(0, s.recent.length - 5),
    });
  }

  const pending = state.proposals.filter((p) => p.state === "pending");
  const first = pending[0];
  if (first) {
    blocks.push({
      id: "decisions",
      kind: "decisions",
      priority: 105,
      span: 2,
      tone: "info",
      tag: "Waiting on you",
      proj: first.proj ?? state.projects[0]?.id ?? "",
      tab: "overview",
      projName: null,
      title: `${pending.length} proposal${pending.length === 1 ? "" : "s"} to accept or dismiss`,
      proposals: pending.slice(0, 3),
      more: Math.max(0, pending.length - 3),
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

// ---- the daily brief ------------------------------------------------------

/** Everything a widget needs, resolved from live state; null when what it points at is gone. */
export type ResolvedWidget =
  | { type: "metric"; project: Project; milestone: Milestone; metric: Metric }
  | { type: "gates"; project: Project; milestone: Milestone }
  | { type: "release"; project: Project; release: Release; state: ReleaseState; rows: CriterionRow[] }
  | { type: "governance"; project: Project; counts: Record<GovStatus, number>; missing: string[] }
  | { type: "value"; project: Project; dim: Dim; target: number; eligible: number }
  | { type: "proposals"; proposals: Proposal[] }
  | { type: "ci"; project: Project; pr: PullRequest; build: Build | null }
  | { type: "upcoming"; items: Upcoming[] }
  | { type: "activity"; items: FeedItem[] }
  | { type: "table"; columns: string[]; rows: string[][] };

export const resolveWidget = (w: Widget, state: AppState, cal: Calendar = calendarOf(state)): ResolvedWidget | null => {
  const project = (pid: string) => state.projects.find((p) => p.id === pid);
  switch (w.type) {
    case "metric": {
      const p = project(w.proj);
      const m = p?.milestones.find((x) => x.id === w.mid);
      const x = m?.metrics.find((y) => y.id === w.xid);
      return p && m && x ? { type: "metric", project: p, milestone: m, metric: x } : null;
    }
    case "gates": {
      const p = project(w.proj);
      const m = p?.milestones.find((x) => x.id === w.mid);
      return p && m && m.metrics.length ? { type: "gates", project: p, milestone: m } : null;
    }
    case "release": {
      const p = project(w.proj);
      const r = (state.releases[w.proj] ?? []).find((x) => x.id === w.rid);
      if (!p || !r) return null;
      const st = releaseState(r, p, cal);
      return { type: "release", project: p, release: r, state: st, rows: r.criteria.map((c, i) => ({ label: c.label, eval: st.evals[i] ?? { ok: false, pending: false, sub: "" } })) };
    }
    case "governance": {
      const p = project(w.proj);
      return p ? { type: "governance", project: p, counts: govCounts(p), missing: p.governance.filter((g) => g.status === "missing").map((g) => g.name) } : null;
    }
    case "value": {
      const p = project(w.proj);
      return p ? { type: "value", project: p, dim: w.dim, target: p.targets[w.dim], eligible: eligible(p, w.dim) } : null;
    }
    case "proposals": {
      const ids = new Set(w.ids);
      const list = state.proposals.filter((p) => ids.has(p.id));
      return list.length ? { type: "proposals", proposals: list } : null;
    }
    case "ci": {
      const p = project(w.proj);
      const d = state.dev[w.proj];
      const pr = d?.prs.find((x) => x.repo === w.repo && x.number === w.number);
      if (!p || !d || !pr) return null;
      const build = [...d.builds].filter((b) => b.repo === pr.repo && b.status === "fail").sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null;
      return { type: "ci", project: p, pr, build };
    }
    case "upcoming": {
      const until = new Date(new Date(cal.asOf).getTime() + w.days * 86_400_000).toISOString().slice(0, 10);
      const items = deriveUpcoming(state, cal, 12).filter((u) => u.at <= until);
      return items.length ? { type: "upcoming", items } : null;
    }
    case "activity": {
      const items = recentEvents(state.events, cal.asOf, w.hours)
        .slice(0, 8)
        .map((e): FeedItem => ({ at: e.at, type: e.type, proj: e.proj, tab: e.tab, text: e.text }));
      return items.length ? { type: "activity", items } : null;
    }
    case "table":
      return w.columns.length && w.rows.length ? { type: "table", columns: w.columns, rows: w.rows } : null;
  }
};

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** A widget spec from the model, typed and pointing at things that exist, or null. */
export const parseWidget = (raw: unknown, state: AppState): Widget | null => {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const proj = str(o.proj);
  const mid = str(o.mid);
  const xid = str(o.xid);
  const rid = str(o.rid);
  const repo = str(o.repo);
  let w: Widget | null = null;
  switch (o.type) {
    case "metric":
      w = proj && mid && xid ? { type: "metric", proj, mid, xid } : null;
      break;
    case "gates":
      w = proj && mid ? { type: "gates", proj, mid } : null;
      break;
    case "release":
      w = proj && rid ? { type: "release", proj, rid } : null;
      break;
    case "governance":
      w = proj ? { type: "governance", proj } : null;
      break;
    case "value":
      w = proj && (o.dim === "fte" || o.dim === "time") ? { type: "value", proj, dim: o.dim } : null;
      break;
    case "proposals":
      w = Array.isArray(o.ids) ? { type: "proposals", ids: o.ids.filter((x): x is string => typeof x === "string").slice(0, 6) } : null;
      break;
    case "ci": {
      const n = num(o.number);
      w = proj && repo && n !== null ? { type: "ci", proj, repo, number: n } : null;
      break;
    }
    case "upcoming":
      w = { type: "upcoming", days: Math.max(1, Math.min(90, num(o.days) ?? 14)) };
      break;
    case "activity":
      w = { type: "activity", hours: Math.max(1, Math.min(24 * 14, num(o.hours) ?? 48)) };
      break;
    case "table": {
      const columns = Array.isArray(o.columns) ? o.columns.filter((c): c is string => typeof c === "string").slice(0, 6) : [];
      const rows = Array.isArray(o.rows) ? o.rows.filter((r): r is unknown[] => Array.isArray(r)).map((r) => r.map((c) => String(c ?? "")).slice(0, columns.length)).slice(0, 12) : [];
      w = columns.length >= 2 && rows.length ? { type: "table", columns, rows } : null;
      break;
    }
    default:
      w = null;
  }
  return w && resolveWidget(w, state) ? w : null;
};

/** An action link from the model: a short label and a place that exists (a project tab, or the inbox). */
export const parseAction = (raw: unknown, state: Pick<AppState, "projects">): BriefAction | null => {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const label = str(o.label);
  const proj = str(o.proj);
  if (!label || !proj) return null;
  if (proj === "inbox" || proj === "agents") return { label: label.slice(0, 32), proj, tab: "overview" };
  if (!state.projects.some((p) => p.id === proj)) return null;
  const tab = (PROJECT_TABS as readonly string[]).includes(String(o.tab)) ? (o.tab as ProjectTab) : "overview";
  return { label: label.slice(0, 32), proj, tab };
};

/** The ids a brief may point at, one line per project, so the model never has to guess. */
export const factIndex = (state: AppState): string => {
  const lines: string[] = [];
  for (const p of state.projects) {
    const ms = p.milestones.map((m) => `${m.id}${m.metrics.length ? ` (metrics: ${m.metrics.map((x) => `${x.id} "${x.label}"`).join(", ")})` : ""}`);
    const rels = (state.releases[p.id] ?? []).map((r) => r.id);
    const prs = (state.dev[p.id]?.prs ?? []).filter((x) => x.status === "open").map((x) => `${x.repo}#${x.number}${x.checks === "fail" ? " (checks failing)" : ""}`);
    lines.push(`- proj "${p.id}" (${p.name}): milestones ${ms.join("; ") || "none"}; releases ${rels.join(", ") || "none"}; open PRs ${prs.join(", ") || "none"}`);
  }
  const pending = state.proposals.filter((p) => p.state === "pending");
  lines.push(`- pending proposals: ${pending.map((p) => p.id).join(", ") || "none"}`);
  return lines.join("\n");
};

/** Markdown for a widget, so judges and grounding checks see what the reader sees. */
export const widgetMarkdown = (w: Widget): string => {
  switch (w.type) {
    case "table":
      return [`| ${w.columns.join(" | ")} |`, `| ${w.columns.map(() => "---").join(" | ")} |`, ...w.rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
    case "proposals":
      return `[widget: proposals ${w.ids.join(", ")}]`;
    case "metric":
      return `[widget: metric ${w.proj}/${w.mid}/${w.xid}]`;
    case "gates":
      return `[widget: gates ${w.proj}/${w.mid}]`;
    case "release":
      return `[widget: release ${w.proj}/${w.rid}]`;
    case "governance":
      return `[widget: governance ${w.proj}]`;
    case "value":
      return `[widget: value ${w.proj} ${w.dim}]`;
    case "ci":
      return `[widget: ci ${w.proj} ${w.repo}#${w.number}]`;
    case "upcoming":
      return `[widget: upcoming ${w.days} days]`;
    case "activity":
      return `[widget: activity ${w.hours} hours]`;
  }
};

/**
 * The composer's own brief, for a workspace without a model or while the
 * curator has not run yet: one section per signal that matters, each with
 * the widget that shows it.
 */
export const defaultBrief = (state: AppState, cal: Calendar = calendarOf(state), scope: "workspace" | "project" = "workspace"): { headline: string; sections: BriefSection[] } => {
  const s = detectSignals(state, cal);
  const where = scope === "project" ? "on this project" : "in the portfolio";
  const narrative = writeNarrativeFor(state, s);
  const sections: BriefSection[] = [];
  const pending = state.proposals.filter((p) => p.state === "pending");
  if (pending.length) {
    const from = [...new Set(pending.map((p) => state.agents.find((a) => a.id === p.agentId)?.name ?? p.agentId))].join(", ");
    sections.push({ group: "top", text: `Review ${pending.length} proposal${pending.length === 1 ? "" : "s"} from ${from} waiting on your decision.`, tip: "Accept applies the change through the same paths the editors use; dismiss records the decision.", action: { label: "Review proposals", proj: "inbox", tab: "overview" }, widget: { type: "proposals", ids: pending.slice(0, 3).map((p) => p.id) } });
  }
  for (const { p, r, st } of s.blocked.slice(0, 2)) {
    const unmet = r.criteria.filter((_, i) => !st.evals[i]?.ok).map((c) => c.label);
    sections.push({ group: "top", text: `${r.id} ${r.name} on ${p.name} is blocked with ${st.met} of ${st.total} go-live criteria met, targeting ${monthLabel(r.month, cal.todayYm)}.`, tip: unmet.length ? `Unmet: ${unmet.slice(0, 3).join("; ")}.` : null, action: { label: "View release", proj: p.id, tab: "roadmap" }, widget: { type: "release", proj: p.id, rid: r.id } });
  }
  for (const { p, m, gap, worst } of s.shortfalls.slice(0, 1)) sections.push({ group: "top", text: `${worst.label} on ${m.name} (${p.name}) sits ${gap}pt${gap === 1 ? "" : "s"} under its base gate, the closest fix ${where}.`, tip: null, action: { label: "View gates", proj: p.id, tab: "value" }, widget: { type: "gates", proj: p.id, mid: m.id } });
  for (const { pid, pr } of s.failPRs.slice(0, 1)) {
    const p = state.projects.find((x) => x.id === pid);
    if (p) sections.push({ group: "top", text: `CI is failing on ${pr.repo} #${pr.number} (${p.name}), open ${pr.title ? `for "${pr.title}"` : "now"}.`, tip: null, action: { label: "View PR", proj: p.id, tab: "development" }, widget: null });
  }
  for (const p of s.t1gaps.slice(0, 1)) sections.push({ group: "top", text: `${p.name} is Tier 1 with ${blockers(p)} governance item${blockers(p) === 1 ? "" : "s"} still missing.`, tip: `Missing: ${p.governance.filter((g) => g.status === "missing").map((g) => g.name).slice(0, 3).join(", ")}.`, action: { label: "View governance", proj: p.id, tab: "governance" }, widget: null });
  for (const { line, name } of s.budgets.slice(0, 1)) {
    const spent = line.against === "usd" ? fmtUsd(line.spend.usd ?? 0) : `${fmtTokens(line.spend.tokens)} tokens`;
    sections.push({ group: line.state === "over" ? "top" : "fyi", text: `${name} has used ${spent} of its ${line.budget ? budgetLabel(line.budget) : ""} monthly budget (${Math.round((line.used ?? 0) * 100)}%).`, tip: line.state === "over" ? "Runs are refused until the budget is raised on the Agents page or the month turns." : "Scheduled runs pause once the ceiling is reached.", action: { label: "View spend", proj: "agents", tab: "overview" }, widget: null });
  }
  if (s.brief) sections.push({ group: "fyi", text: `This week's brief by ${state.agents.find((a) => a.id === s.brief?.agentId)?.name ?? "Monday"}: ${s.brief.summary}`, tip: null, action: null, widget: null });
  const next = s.upcoming[0];
  if (next) sections.push({ group: "fyi", text: `Next on the calendar: ${next.text} on ${next.date}${next.sub ? ` (${next.sub})` : ""}.`, tip: null, action: { label: "View calendar", proj: next.proj, tab: next.tab }, widget: s.upcoming.length > 1 ? { type: "upcoming", days: 56 } : null });
  const moved = s.recent[0];
  if (moved) sections.push({ group: "fyi", text: `${s.recent.length} thing${s.recent.length === 1 ? "" : "s"} moved ${state.workspace.lastGlanceAt ? "since you last looked" : "since yesterday"}, most recently: ${moved.text}.`, tip: null, action: { label: "View activity", proj: moved.proj, tab: moved.tab }, widget: s.recent.length > 1 ? { type: "activity", hours: 48 } : null });
  return { headline: narrative[0] ?? "Nothing needs you right now.", sections: sections.slice(0, 8) };
};

/**
 * A fingerprint of what the composer found, so a layout knows when facts moved
 * under it. The activity card's title counts events since the reader's last
 * visit, which changes on every visit without any fact moving, so only its id
 * counts.
 */
export const blocksHash = (blocks: Pick<Block, "id" | "title" | "kind">[]): string => {
  let h = 0x811c9dc5;
  for (const ch of blocks.map((b) => (b.kind === "activity" ? b.id : `${b.id}|${b.title}`)).join("\n")) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
};

/** One line per candidate block for the curator's briefing: id, kind, project, title, and the facts it carries. */
export const describeBlock = (b: Block): string => {
  const head = `${b.id} [${b.kind}${b.projName ? `, ${b.projName}` : ""}, ${b.tone}] ${b.title}`;
  switch (b.kind) {
    case "blocked_release":
      return `${head} — unmet: ${b.rows.filter((r) => !r.eval.ok).map((r) => r.label).join("; ") || "none"}`;
    case "below_gate":
      return `${head} — ${b.metrics.map((x) => `${x.label} ${x.current}% vs base ${x.base}%`).join(", ")}`;
    case "ci_failing":
      return `${head} — ${b.pr.repo} #${b.pr.number}${b.build ? `; ${b.build.note}` : ""}`;
    case "tier1_gaps":
      return `${head} — missing: ${b.missing.join(", ")}`;
    case "near_stretch":
      return `${head} — ${b.metrics.map((x) => `${x.label} ${x.current}% vs stretch ${x.stretch}%`).join(", ")}`;
    case "value_trajectory":
      return `${head} — eligible ${b.eligible}% of ${b.target}%`;
    case "ready_release":
      return head;
    case "agent_flag":
      return `${head} — by ${b.agentName}`;
    case "brief":
      return `${head} — this week's brief by ${b.agentName}`;
    case "upcoming":
      return `${head} — ${b.items.map((u) => `${u.date} ${u.text}`).join("; ")}`;
    case "activity":
      return `${head} — ${b.items.map((i) => i.text).join("; ")}`;
    case "decisions":
      return `${head} — ${b.proposals.map((p) => `${p.id} from ${p.agentId}`).join(", ")}`;
    case "budget":
      return `${head} — ${b.line.spend.runs} runs this month${b.line.state === "over" ? "; scheduled runs are paused until the budget is raised or the month turns" : ""}`;
  }
};

/**
 * The workspace seen from one project: only its facts, proposals, runs,
 * events, and calendar, with its own brief in the brief slot. The composer
 * and curator then work unchanged, one project at a time.
 */
export const projectView = (state: AppState, pid: string): AppState => ({
  ...state,
  projects: state.projects.filter((p) => p.id === pid),
  releases: { [pid]: state.releases[pid] ?? [] },
  dev: state.dev[pid] ? { [pid]: state.dev[pid] } : {},
  runs: state.runs.filter((r) => r.proj === pid),
  proposals: state.proposals.filter((p) => p.proj === pid),
  rules: state.rules.filter((r) => r.proj === null || r.proj === pid),
  brief: state.projectBriefs[pid] ?? null,
  events: state.events.filter((e) => e.proj === pid),
  calendar: state.calendar.filter((c) => c.proj === pid),
});

/** The single entry point: full state in, ranked typed blocks out. */
export const composeGlance = (state: AppState, cal: Calendar = calendarOf(state)): Block[] => rankBlocks(detectSignals(state, cal), state);

/** Blocks plus narrative, for the page header. */
export const composeGlancePage = (state: AppState, cal: Calendar = calendarOf(state)): Glance => {
  const s = detectSignals(state, cal);
  return { narrative: writeNarrativeFor(state, s), blocks: rankBlocks(s, state), projectCount: state.projects.length };
};
