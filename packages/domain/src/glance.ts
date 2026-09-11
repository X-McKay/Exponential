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
import { attentionRuns, latestRunOfKind } from "./agents.ts";
import { deriveUpcoming, recentEvents } from "./feed.ts";
import type { FeedItem, Upcoming } from "./feed.ts";
import { ZONES } from "./types.ts";
import type { AgentRun, AppState, Build, Dim, GlanceLayout, GovStatus, Metric, Milestone, Placement, Project, ProjectTab, Proposal, PullRequest, Release, Zone } from "./types.ts";

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
  | (BlockBase & { kind: "value_trajectory"; milestones: Milestone[]; dim: Dim; target: number; realized: number })
  | (BlockBase & { kind: "ready_release"; release: Release })
  | (BlockBase & { kind: "agent_flag"; run: AgentRun; agentName: string })
  | (BlockBase & { kind: "brief"; run: AgentRun; agentName: string })
  | (BlockBase & { kind: "upcoming"; items: Upcoming[]; more: number })
  | (BlockBase & { kind: "activity"; items: FeedItem[]; more: number })
  | (BlockBase & { kind: "decisions"; proposals: Proposal[]; more: number });

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
    for (const pr of [...d.prs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) if (pr.status === "open" && pr.checks === "fail") failPRs.push({ pid, pr });
    for (const b of [...d.builds].sort((x, y) => y.startedAt.localeCompare(x.startedAt))) if (b.status === "fail") failBuilds.push({ pid, b });
  }

  const t1gaps = state.projects.filter((p) => p.tier === 1 && blockers(p) > 0);
  const flags = attentionRuns(state.runs, cal.asOf).filter((r) => state.projects.some((p) => p.id === r.proj));
  const brief = latestRunOfKind("brief", state.agents, state.runs, cal.asOf);
  const ratio = (p: Project): number => (p.targets.fte > 0 ? realized(p, "fte") / p.targets.fte : 0);
  const bestValue = [...state.projects].sort((a, b) => ratio(b) - ratio(a))[0] ?? null;

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
      title: `${realized(p, "fte")}% of ${p.targets.fte}% FTE target realized`,
      milestones: p.milestones,
      dim: "fte",
      target: p.targets.fte,
      realized: realized(p, "fte"),
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

// ---- zones & layouts ----------------------------------------------------

/** Where a block belongs by its nature, when no curator has said otherwise. */
export const zoneOf = (kind: BlockKind): Zone => {
  switch (kind) {
    case "decisions":
    case "agent_flag":
    case "ready_release":
      return "decide";
    case "blocked_release":
    case "below_gate":
    case "ci_failing":
    case "tier1_gaps":
    case "near_stretch":
    case "value_trajectory":
      return "watch";
    case "brief":
    case "upcoming":
    case "activity":
      return "know";
  }
};

/** How many cards each zone shows before the rest fold into "more". */
export const ZONE_CAP: Record<Zone, number> = { decide: 2, watch: 3, know: 2 };

export interface Placed {
  block: Block;
  why: string | null;
}

export interface ResolvedLayout {
  zones: Record<Zone, Placed[]>;
  /** Blocks the layout did not place, in composer order. */
  more: Block[];
  headline: string | null;
  /** Null when the composer's default order is showing. */
  curated: GlanceLayout | null;
}

/** The composer's own layout: zone by kind, priority order, capped per zone. */
export const defaultLayout = (blocks: Block[]): ResolvedLayout => {
  const zones: Record<Zone, Placed[]> = { decide: [], watch: [], know: [] };
  const more: Block[] = [];
  for (const b of blocks) {
    const z = zoneOf(b.kind);
    if (zones[z].length < ZONE_CAP[z]) zones[z].push({ block: b, why: null });
    else more.push(b);
  }
  return { zones, more, headline: null, curated: null };
};

/**
 * Resolve a curated layout against today's blocks: placements whose block is
 * gone are dropped, blocks it never mentioned fold into "more". Falls back to
 * the default when the layout places nothing that still exists.
 */
export const applyLayout = (blocks: Block[], layout: GlanceLayout | null): ResolvedLayout => {
  if (!layout) return defaultLayout(blocks);
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const zones: Record<Zone, Placed[]> = { decide: [], watch: [], know: [] };
  const used = new Set<string>();
  for (const p of layout.placements) {
    const block = byId.get(p.blockId);
    if (!block || used.has(p.blockId)) continue;
    used.add(p.blockId);
    zones[p.zone].push({ block, why: p.why || null });
  }
  if (used.size === 0) return defaultLayout(blocks);
  return { zones, more: blocks.filter((b) => !used.has(b.id)), headline: layout.headline || null, curated: layout };
};

/** Placements as the curator returned them, validated against the blocks that exist. */
export const validPlacements = (raw: unknown, blocks: Pick<Block, "id">[]): Placement[] => {
  if (!Array.isArray(raw)) return [];
  const ids = new Set(blocks.map((b) => b.id));
  const out: Placement[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    const zone = ZONES.find((z) => z === o.zone);
    if (!zone || typeof o.blockId !== "string" || !ids.has(o.blockId) || out.some((p) => p.blockId === o.blockId)) continue;
    out.push({ zone, blockId: o.blockId, why: typeof o.why === "string" ? o.why.trim().slice(0, 200) : "" });
  }
  return out;
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
      return `${head} — realized ${b.realized}% of ${b.target}%`;
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
  }
};

/** The single entry point: full state in, ranked typed blocks out. */
export const composeGlance = (state: AppState, cal: Calendar = calendarOf(state)): Block[] => rankBlocks(detectSignals(state, cal), state);

/** Blocks plus narrative, for the page header. */
export const composeGlancePage = (state: AppState, cal: Calendar = calendarOf(state)): Glance => {
  const s = detectSignals(state, cal);
  return { narrative: writeNarrativeFor(state, s), blocks: rankBlocks(s, state), projectCount: state.projects.length };
};
