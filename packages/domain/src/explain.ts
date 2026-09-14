// ================= provenance =================
//
// Every derived number can say where it came from. An explanation is a tree:
// the value, the rule that produced it from its inputs, and the inputs, down
// to the facts themselves. Leaves carry a fact reference so the page can open
// the thing, and `touches` finds who last changed a fact and how (an accepted
// proposal, a recorded reading). Nothing here is stored; it is the same
// derivation as derive.ts, kept as a trace instead of a number.

import type { Calendar } from "./calendar.ts";
import { monthLabel } from "./calendar.ts";
import { blockers, eligible, evalCriterion, impactOf, isMeasurable, metricLevel, readiness, releaseState, shippedCount, tierOf } from "./derive.ts";
import { GSTATUS_LABEL, STATUS_LABEL } from "./labels.ts";
import type { AgentRun, AppState, Dim, GovernanceItem, Metric, Milestone, Project, ProjectTab, Proposal, Release } from "./types.ts";

export type FactRef =
  | { kind: "milestone"; proj: string; mid: string }
  | { kind: "metric"; proj: string; mid: string; xid: string }
  | { kind: "governance"; proj: string; gid: string }
  | { kind: "targets"; proj: string }
  | { kind: "release"; proj: string; rid: string }
  | { kind: "criterion"; proj: string; rid: string; index: number }
  | { kind: "run"; runId: string; proj: string | null };

export interface Explanation {
  label: string;
  value: string;
  /** How the value follows from the inputs, in one sentence; null for a fact. */
  rule: string | null;
  /** The fact this node is, when it is one. */
  fact: FactRef | null;
  inputs: Explanation[];
}

/** Where a fact lives in the app. */
export const factTab = (f: FactRef): ProjectTab => {
  switch (f.kind) {
    case "milestone":
    case "metric":
    case "targets":
      return "value";
    case "governance":
      return "governance";
    case "release":
    case "criterion":
      return "roadmap";
    case "run":
      return "overview";
  }
};

const pct = (n: number): string => `${Math.round(n * 100)}%`;
const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

// ---- governance -------------------------------------------------------------

const govFact = (p: Pick<Project, "id">, g: GovernanceItem): Explanation => ({
  label: g.name,
  value: `${GSTATUS_LABEL[g.status]}${g.date ? ` · ${g.date}` : ""} · owner ${g.owner}`,
  rule: null,
  fact: { kind: "governance", proj: p.id, gid: g.id },
  inputs: [],
});

/** Approved items over required items; N/A items do not count either way. */
export const explainReadiness = (p: Pick<Project, "id" | "governance">): Explanation => {
  const required = p.governance.filter((g) => g.status !== "na");
  const approved = required.filter((g) => g.status === "approved");
  return {
    label: "Governance readiness",
    value: pct(readiness(p)),
    rule: required.length ? `${approved.length} approved of ${required.length} required item${plural(required.length, "", "s")}${p.governance.length > required.length ? ` (${p.governance.length - required.length} marked N/A and excluded)` : ""}` : "no required governance items, so readiness is 0%",
    fact: null,
    inputs: p.governance.map((g) => govFact(p, g)),
  };
};

export const explainBlockers = (p: Pick<Project, "id" | "governance">): Explanation => {
  const missing = p.governance.filter((g) => g.status === "missing");
  return {
    label: "Missing governance items",
    value: String(blockers(p)),
    rule: "items whose status is Missing",
    fact: null,
    inputs: missing.map((g) => govFact(p, g)),
  };
};

export const explainOpenItems = (p: Pick<Project, "id" | "governance">): Explanation => {
  const open = p.governance.filter((g) => g.status === "missing" || g.status === "draft" || g.status === "in_review");
  return {
    label: "Open governance items",
    value: String(open.length),
    rule: "items still Missing, Draft, or In review",
    fact: null,
    inputs: open.map((g) => govFact(p, g)),
  };
};

// ---- gates and value ---------------------------------------------------------

const metricFact = (p: Pick<Project, "id">, m: Pick<Milestone, "id">, x: Metric): Explanation => {
  const level = metricLevel(x);
  return {
    label: x.label,
    value: `${x.current}% · ${level === "stretch" ? "at stretch" : level === "base" ? "at base" : "below base"} (base ≥ ${x.base}%, stretch ≥ ${x.stretch}%)`,
    rule: null,
    fact: { kind: "metric", proj: p.id, mid: m.id, xid: x.id },
    inputs: [],
  };
};

const statusFact = (p: Pick<Project, "id">, m: Milestone, cal?: Pick<Calendar, "todayYm">): Explanation => ({
  label: `${m.id} status`,
  value: `${STATUS_LABEL[m.status]}${cal ? ` · ${monthLabel(m.month, cal.todayYm)}` : ""}`,
  rule: null,
  fact: { kind: "milestone", proj: p.id, mid: m.id },
  inputs: [],
});

/** Which gate a milestone clears, from its status and every metric against its thresholds. */
export const explainTier = (p: Pick<Project, "id">, m: Milestone): Explanation => {
  const t = tierOf(m);
  const measurable = isMeasurable(m);
  const value = t === 2 ? "Stretch gate cleared" : t === 1 ? "Base gate cleared" : measurable ? (m.metrics.length ? "Below the base gate" : "No gate: no metrics defined") : "Unmeasured";
  const rule = !measurable ? "only milestones In eval or Shipped are measured; earlier ones clear no gate" : m.metrics.length === 0 ? "a milestone with no metrics can never clear a gate" : t === 2 ? "every metric is at or above its stretch threshold" : t === 1 ? "every metric is at or above its base threshold, not every one at stretch" : `${m.metrics.filter((x) => x.current < x.base).length} of ${m.metrics.length} metric${plural(m.metrics.length, "", "s")} below its base threshold`;
  return { label: `${m.name} · gate`, value, rule, fact: null, inputs: [statusFact(p, m), ...m.metrics.map((x) => metricFact(p, m, x))] };
};

/** The impact one milestone contributes on a dimension: its base or stretch figure, or nothing. */
export const explainImpact = (p: Pick<Project, "id">, m: Milestone, d: Dim): Explanation => {
  const t = tierOf(m);
  const shipped = m.status === "shipped";
  const v = shipped ? impactOf(m, d) : 0;
  const label = d === "fte" ? "FTE" : "time";
  return {
    label: `${m.id} ${m.name}`,
    value: `${v}%`,
    rule: !shipped ? `not shipped, so eligible value is 0% (would add ${m.impact.base[d]}% at base, ${m.impact.stretch[d]}% at stretch)` : t === 2 ? `shipped and clearing the stretch gate: the stretch ${label} figure is eligible` : t === 1 ? `shipped and clearing the base gate: the base ${label} figure is eligible` : `shipped but below its base gate, so eligible value is 0% (base would add ${m.impact.base[d]}%)`,
    fact: null,
    inputs: [statusFact(p, m), explainTier(p, m)],
  };
};

/** Value eligible after delivery: gated impact, pending observed-benefit data. */
export const explainEligible = (p: Pick<Project, "id" | "milestones" | "targets">, d: Dim): Explanation => {
  const label = d === "fte" ? "FTE reduction eligible" : "Time reduction eligible";
  const contributing = p.milestones.filter((m) => m.status === "shipped" && impactOf(m, d) > 0);
  return {
    label,
    value: `${eligible(p, d)}%`,
    rule: `${contributing.length} shipped milestone${plural(contributing.length, "", "s")} clearing a gate, impact summed; target ${p.targets[d]}%`,
    fact: null,
    inputs: [
      { label: "Target", value: `${p.targets[d]}%`, rule: null, fact: { kind: "targets", proj: p.id }, inputs: [] },
      ...p.milestones.map((m) => explainImpact(p, m, d)),
    ],
  };
};

/** @deprecated Use explainEligible; the current fact is eligibility, not an observed outcome. */
export const explainRealized = explainEligible;

export const explainShipped = (p: Pick<Project, "id" | "milestones">, cal?: Pick<Calendar, "todayYm">): Explanation => ({
  label: "Milestones shipped",
  value: `${shippedCount(p)} of ${p.milestones.length}`,
  rule: "milestones whose status is Shipped",
  fact: null,
  inputs: p.milestones.map((m) => statusFact(p, m, cal)),
});

export const explainGatesCleared = (p: Pick<Project, "id" | "milestones">): Explanation => {
  const measurable = p.milestones.filter(isMeasurable);
  return {
    label: "Gates cleared",
    value: `${measurable.filter((m) => tierOf(m) > 0).length} of ${measurable.length}`,
    rule: "measurable milestones (In eval or Shipped) whose every metric is at or above its base threshold",
    fact: null,
    inputs: measurable.map((m) => explainTier(p, m)),
  };
};

// ---- releases ---------------------------------------------------------------

export const explainCriterion = (p: Pick<Project, "id" | "milestones" | "governance">, rel: Release, index: number): Explanation => {
  const c = rel.criteria[index];
  if (!c) return { label: "criterion", value: "missing", rule: null, fact: null, inputs: [] };
  const e = evalCriterion(c, p);
  const value = e.ok ? "Met" : e.pending ? "Pending" : "Not met";
  const fact: FactRef = { kind: "criterion", proj: p.id, rid: rel.id, index };
  switch (c.type) {
    case "gate": {
      const m = p.milestones.find((x) => x.id === c.ms);
      return { label: c.label, value: `${value} · ${e.sub}`, rule: m ? "met when the milestone clears its base gate; pending while it is not yet measured" : "the milestone it points at no longer exists", fact, inputs: m ? [explainTier(p, m)] : [] };
    }
    case "gov": {
      const g = p.governance.find((x) => x.id === c.gid);
      return { label: c.label, value: `${value} · ${e.sub}`, rule: g ? "met when the governance item is Approved or N/A; pending while In review or Draft" : "the governance item it points at is not tracked", fact, inputs: g ? [govFact(p, g)] : [] };
    }
    case "manual":
      return { label: c.label, value, rule: "confirmed by hand on the release", fact, inputs: [] };
  }
};

export const explainRelease = (p: Pick<Project, "id" | "milestones" | "governance">, rel: Release, cal: Pick<Calendar, "todayYm">): Explanation => {
  const st = releaseState(rel, p, cal);
  return {
    label: `${rel.id} ${rel.name}`,
    value: `${st.label} · ${st.met} of ${st.total} criteria met`,
    rule: `Ready when every configured criterion is met; shipment requires explicit deployment evidence. Empty criteria are Not configured. Otherwise Blocked when the target is within a month and At risk when further out`,
    fact: { kind: "release", proj: p.id, rid: rel.id },
    inputs: rel.criteria.map((_, i) => explainCriterion(p, rel, i)),
  };
};

// ---- who touched it ------------------------------------------------------------

export interface Touch {
  at: string;
  /** Who made the change: an agent's name via a proposal, a person, or a source. */
  who: string;
  what: string;
  proposal: Proposal | null;
}

const targets = (a: Proposal["action"], f: FactRef): boolean => {
  switch (f.kind) {
    case "governance":
      return (a.type === "governance_status" && a.gid === f.gid) || a.type === "governance_item";
    case "milestone":
      return a.type === "milestone_status" && a.mid === f.mid;
    case "targets":
      return a.type === "targets";
    case "metric":
    case "release":
    case "criterion":
    case "run":
      return false;
  }
};

/** Accepted proposals that changed a fact, newest first, plus the latest reading behind a metric. */
export const touches = (state: Pick<AppState, "proposals" | "agents" | "projects">, f: FactRef): Touch[] => {
  const out: Touch[] = [];
  for (const p of state.proposals) {
    if (p.state !== "accepted" || !p.decidedAt) continue;
    if (f.kind === "run" || p.proj !== f.proj) continue;
    if (!targets(p.action, f)) continue;
    const agent = state.agents.find((a) => a.id === p.agentId)?.name ?? p.agentId;
    out.push({ at: p.decidedAt, who: agent, what: `${p.ruleId ? `rule ${p.ruleId} via ` : ""}proposal ${p.id}, accepted`, proposal: p });
  }
  if (f.kind === "metric") {
    const x = state.projects.find((p) => p.id === f.proj)?.milestones.find((m) => m.id === f.mid)?.metrics.find((y) => y.id === f.xid);
    if (x?.readAt) out.push({ at: x.readAt, who: x.readSource === "eval" ? "eval suite" : "a person", what: `reading ${x.current}% recorded`, proposal: null });
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : -1));
};

// ---- agent spend ----------------------------------------------------------------

/** Spend as a tree: per agent, then the runs behind it; leaves point at runs. */
export const explainRuns = (label: string, value: string, rule: string, runs: AgentRun[], state: Pick<AppState, "agents">, describe: (r: AgentRun) => string): Explanation => {
  const byAgent = new Map<string, AgentRun[]>();
  for (const r of runs) byAgent.set(r.agentId, [...(byAgent.get(r.agentId) ?? []), r]);
  return {
    label,
    value,
    rule,
    fact: null,
    inputs: [...byAgent.entries()].map(([agentId, rs]) => ({
      label: state.agents.find((a) => a.id === agentId)?.name ?? agentId,
      value: `${rs.length} run${plural(rs.length, "", "s")}`,
      rule: null,
      fact: null,
        inputs: rs.slice(0, 12).map((r) => ({ label: `${r.id} · ${r.summary.slice(0, 60)}`, value: describe(r), rule: null, fact: r.id.startsWith("usage-") ? null : { kind: "run", runId: r.id, proj: r.proj }, inputs: [] })),
    })),
  };
};
