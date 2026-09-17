// ================= proposals (derived helpers) =================

import { GSTATUS_LABEL, STATUS_LABEL, TIER_LABEL } from "./labels.ts";
import type { AppState, Criterion, Impact, Proposal, ProposalAction, ProposalEvidence, Rule } from "./types.ts";

/** Kinds staged by "Update project from documents": edits to the project record rather than a status nudge. */
export const RECORD_ACTIONS: readonly ProposalAction["type"][] = ["project_details", "team_member", "repo", "governance_update", "milestone_create", "milestone_update", "release_create", "release_update"];

export const pendingProposals = (state: Pick<AppState, "proposals">, proj?: string): Proposal[] =>
  state.proposals.filter((p) => p.state === "pending" && (proj === undefined || p.proj === proj));

/** One line saying what accepting the proposal would do. */
export const describeAction = (a: ProposalAction, state: Pick<AppState, "projects" | "agents">, proj: string | null): string => {
  const p = state.projects.find((x) => x.id === proj);
  const agentName = (id: string) => state.agents.find((x) => x.id === id)?.name ?? id;
  switch (a.type) {
    case "agent_prompt":
      return a.prompt === null ? `Reset ${agentName(a.agentId)} to its built-in instructions` : `Update ${agentName(a.agentId)}'s instructions (${a.prompt.split(/\s+/).filter(Boolean).length} words)`;
    case "agent_model":
      return a.model === null ? `Switch ${agentName(a.agentId)} back to the default model` : `Switch ${agentName(a.agentId)} to ${a.model}`;
    case "governance_status":
      return `Move ${p?.governance.find((g) => g.id === a.gid)?.name ?? a.gid} to ${GSTATUS_LABEL[a.status]}`;
    case "milestone_status":
      return `Move ${p?.milestones.find((m) => m.id === a.mid)?.name ?? a.mid} to ${STATUS_LABEL[a.status]}`;
    case "governance_item":
      return `Add governance item "${a.name}" (${a.cat}, ${GSTATUS_LABEL[a.status]}, owner ${a.owner})`;
    case "calendar_event":
      return `Add calendar event on ${a.date}: ${a.text}`;
    case "targets":
      return `Set targets to FTE ${a.fte}% and time ${a.time}%`;
    case "project_details": {
      const parts: string[] = [];
      if (a.description !== undefined) parts.push("description");
      if (a.stage !== undefined) parts.push(`stage to ${a.stage}`);
      if (a.tier !== undefined) parts.push(`risk tier to ${a.tier === null ? "untiered" : TIER_LABEL[a.tier]}`);
      if (a.committee !== undefined) parts.push(a.committee ? `AI committee approval ${a.committee.date} (${a.committee.ref})` : "AI committee approval cleared");
      return `Update ${parts.join(", ") || "project details"}`;
    }
    case "team_member":
      return `${p?.team.some((t) => t.ini === a.ini) ? "Update" : "Add"} team member ${a.name} (${a.ini}, ${a.role})`;
    case "repo":
      return `${p?.repos.some((r) => r.name === a.name) ? "Update" : "Link"} repository ${a.name}`;
    case "governance_update": {
      const name = p?.governance.find((g) => g.id === a.gid)?.name ?? a.gid;
      const parts: string[] = [];
      if (a.status !== undefined) parts.push(`to ${GSTATUS_LABEL[a.status]}`);
      if (a.owner !== undefined) parts.push(`owner ${a.owner}`);
      if (a.date !== undefined) parts.push(a.date ? `dated ${a.date}` : "date cleared");
      if (a.detail !== undefined) parts.push("detail");
      return `Update ${name}: ${parts.join(", ") || "no change"}`;
    }
    case "milestone_create":
      return `Add milestone "${a.name}" (${STATUS_LABEL[a.status]}, ${a.month})`;
    case "milestone_update": {
      const name = p?.milestones.find((m) => m.id === a.mid)?.name ?? a.mid;
      const parts: string[] = [];
      if (a.name !== undefined) parts.push(`rename to "${a.name}"`);
      if (a.status !== undefined) parts.push(`status ${STATUS_LABEL[a.status]}`);
      if (a.month !== undefined) parts.push(`month ${a.month}`);
      if (a.impact !== undefined) parts.push("impact");
      return `Update ${name}: ${parts.join(", ") || "no change"}`;
    }
    case "release_create":
      return `Add release "${a.name}" (${a.month}, ${a.milestoneIds.length} milestone${a.milestoneIds.length === 1 ? "" : "s"}, ${a.criteria.length} criteria)`;
    case "release_update": {
      const parts: string[] = [];
      if (a.name !== undefined) parts.push(`rename to "${a.name}"`);
      if (a.month !== undefined) parts.push(`month ${a.month}`);
      if (a.milestoneIds !== undefined) parts.push(`${a.milestoneIds.length} milestone${a.milestoneIds.length === 1 ? "" : "s"}`);
      if (a.criteria !== undefined) parts.push(`${a.criteria.length} criteria`);
      return `Update release ${a.rid}: ${parts.join(", ") || "no change"}`;
    }
  }
};

export interface RuleStats {
  fired: number;
  accepted: number;
  dismissed: number;
  pending: number;
  /** accepted / decided, or null before any decision. */
  acceptanceRate: number | null;
  /** Enough decisions, nearly all accepted: a person could let it apply on its own. */
  earnedAutonomy: boolean;
}

export const AUTONOMY_MIN_DECISIONS = 5;
export const AUTONOMY_MIN_RATE = 0.8;

/** How a standing rule has been received; derived from the proposals it produced. */
export const ruleStats = (rule: Pick<Rule, "id">, proposals: Proposal[]): RuleStats => {
  const mine = proposals.filter((p) => p.ruleId === rule.id && p.decisionMode !== "automatic");
  const accepted = mine.filter((p) => p.state === "accepted").length;
  const dismissed = mine.filter((p) => p.state === "dismissed").length;
  const decided = accepted + dismissed;
  const rate = decided ? accepted / decided : null;
  return { fired: mine.length, accepted, dismissed, pending: mine.length - decided, acceptanceRate: rate, earnedAutonomy: decided >= AUTONOMY_MIN_DECISIONS && rate !== null && rate >= AUTONOMY_MIN_RATE };
};

/** Next rule id: rule-<n>. */
export const nextRuleId = (rules: Pick<Rule, "id">[]): string => {
  const nums = rules.map((r) => parseInt((r.id.match(/\d+/) ?? ["0"])[0] ?? "0", 10));
  return `rule-${Math.max(0, ...nums) + 1}`;
};

/** Next proposal id: prop-<n>. */
export const nextProposalId = (proposals: Pick<Proposal, "id">[]): string => {
  const nums = proposals.map((r) => parseInt((r.id.match(/\d+/) ?? ["0"])[0] ?? "0", 10));
  return `prop-${Math.max(0, ...nums) + 1}`;
};

// ---- diffs ----------------------------------------------------------------

/** One field of a proposal side by side: what the record says now and what accepting would write. */
export interface DiffRow {
  label: string;
  /** Null when the proposal creates something new. */
  before: string | null;
  after: string;
  changed: boolean;
}

export interface ProposalDiff {
  /** Whether accepting edits an existing record or adds a new one. */
  kind: "update" | "create";
  /** What the change is about: "Milestone MS-3 · Parser", "New release", "Agent Tuner". */
  target: string;
  /** True when the record the proposal names no longer exists. */
  missing: boolean;
  rows: DiffRow[];
}

const fmtImpact = (i: Impact): string => `base FTE ${i.base.fte}% / time ${i.base.time}% · stretch FTE ${i.stretch.fte}% / time ${i.stretch.time}%`;
const fmtCriteria = (c: Criterion[]): string => (c.length ? c.map((x) => x.label).join("; ") : "none");
const fmtList = (xs: string[]): string => (xs.length ? xs.join(", ") : "nothing");
const row = (label: string, before: string | null, after: string): DiffRow => ({ label, before, after, changed: before !== after });

/**
 * The proposal as field-level rows a person can compare. Update shapes list
 * only the fields the proposal sets; create shapes list every field with no
 * "before". Pure: the same action and state always give the same rows.
 */
export const proposalDiff = (a: ProposalAction, state: Pick<AppState, "projects" | "agents"> & Partial<Pick<AppState, "releases">>, proj: string | null): ProposalDiff => {
  const p = state.projects.find((x) => x.id === proj);
  const gone = (target: string): ProposalDiff => ({ kind: "update", target, missing: true, rows: [] });
  switch (a.type) {
    case "agent_prompt": {
      const agent = state.agents.find((x) => x.id === a.agentId);
      if (!agent) return gone(`Agent ${a.agentId}`);
      return { kind: "update", target: `Agent ${agent.name}`, missing: false, rows: [row("Instructions", agent.prompt ?? "Built-in instructions", a.prompt ?? "Built-in instructions")] };
    }
    case "agent_model": {
      const agent = state.agents.find((x) => x.id === a.agentId);
      if (!agent) return gone(`Agent ${a.agentId}`);
      return { kind: "update", target: `Agent ${agent.name}`, missing: false, rows: [row("Model", agent.model ?? "Workspace default", a.model ?? "Workspace default")] };
    }
    case "governance_status": {
      const g = p?.governance.find((x) => x.id === a.gid);
      if (!g) return gone(`Governance item ${a.gid}`);
      return { kind: "update", target: `${g.cat} · ${g.name}`, missing: false, rows: [row("Status", GSTATUS_LABEL[g.status], GSTATUS_LABEL[a.status])] };
    }
    case "milestone_status": {
      const m = p?.milestones.find((x) => x.id === a.mid) ?? p?.historicalMilestones?.find((x) => x.id === a.mid);
      if (!m) return gone(`Milestone ${a.mid}`);
      return { kind: "update", target: `Milestone ${m.id} · ${m.name}`, missing: false, rows: [row("Status", STATUS_LABEL[m.status], STATUS_LABEL[a.status])] };
    }
    case "governance_item":
      return { kind: "create", target: "New governance item", missing: false, rows: [row("Name", null, a.name), row("Category", null, a.cat), row("Status", null, GSTATUS_LABEL[a.status]), row("Owner", null, a.owner), ...(a.detail ? [row("Detail", null, a.detail)] : [])] };
    case "calendar_event":
      return { kind: "create", target: "New calendar event", missing: false, rows: [row("Date", null, a.date), row("Text", null, a.text), ...(a.sub ? [row("Note", null, a.sub)] : []), row("Opens", null, a.tab)] };
    case "targets":
      if (!p) return gone("Project targets");
      return { kind: "update", target: "Value targets", missing: false, rows: [row("FTE reduction", `${p.targets.fte}%`, `${a.fte}%`), row("Time reduction", `${p.targets.time}%`, `${a.time}%`)] };
    case "project_details": {
      if (!p) return gone("Project details");
      const rows: DiffRow[] = [];
      if (a.description !== undefined) rows.push(row("Description", p.description || "(empty)", a.description || "(empty)"));
      if (a.stage !== undefined) rows.push(row("Stage", p.stage, a.stage));
      if (a.tier !== undefined) rows.push(row("Risk tier", p.tier ? TIER_LABEL[p.tier] : "Untiered", a.tier ? TIER_LABEL[a.tier] : "Untiered"));
      if (a.committee !== undefined) rows.push(row("AI committee", p.committee ? `${p.committee.date} · ${p.committee.ref}` : "pending", a.committee ? `${a.committee.date} · ${a.committee.ref}` : "pending"));
      return { kind: "update", target: "Project details", missing: false, rows };
    }
    case "team_member": {
      const t = p?.team.find((x) => x.ini === a.ini);
      return t
        ? { kind: "update", target: `Team member ${t.name}`, missing: false, rows: [row("Name", t.name, a.name), row("Role", t.role, a.role), row("Initials", t.ini, a.ini)] }
        : { kind: "create", target: "New team member", missing: false, rows: [row("Name", null, a.name), row("Role", null, a.role), row("Initials", null, a.ini)] };
    }
    case "repo": {
      const r = p?.repos.find((x) => x.name === a.name);
      return r
        ? { kind: "update", target: `Repository ${r.name}`, missing: false, rows: [row("URL", r.url, a.url)] }
        : { kind: "create", target: "New repository", missing: false, rows: [row("Name", null, a.name), row("URL", null, a.url)] };
    }
    case "governance_update": {
      const g = p?.governance.find((x) => x.id === a.gid);
      if (!g) return gone(`Governance item ${a.gid}`);
      const rows: DiffRow[] = [];
      if (a.status !== undefined) rows.push(row("Status", GSTATUS_LABEL[g.status], GSTATUS_LABEL[a.status]));
      if (a.owner !== undefined) rows.push(row("Owner", g.owner || "unassigned", a.owner));
      if (a.date !== undefined) rows.push(row("Recorded date", g.date ?? "none", a.date ?? "none"));
      if (a.detail !== undefined) rows.push(row("Detail", g.detail || "(empty)", a.detail || "(empty)"));
      return { kind: "update", target: `${g.cat} · ${g.name}`, missing: false, rows };
    }
    case "milestone_create":
      return {
        kind: "create",
        target: "New milestone",
        missing: false,
        rows: [row("Name", null, a.name), row("Status", null, STATUS_LABEL[a.status]), row("Month", null, a.month), row("Impact", null, fmtImpact(a.impact)), ...(a.metrics.length ? [row("Metrics", null, a.metrics.map((x) => `${x.label} (base ≥${x.base}, stretch ≥${x.stretch})`).join("; "))] : [])],
      };
    case "milestone_update": {
      const m = p?.milestones.find((x) => x.id === a.mid);
      if (!m) return gone(`Milestone ${a.mid}`);
      const rows: DiffRow[] = [];
      if (a.name !== undefined) rows.push(row("Name", m.name, a.name));
      if (a.status !== undefined) rows.push(row("Status", STATUS_LABEL[m.status], STATUS_LABEL[a.status]));
      if (a.month !== undefined) rows.push(row("Month", m.month, a.month));
      if (a.impact !== undefined) rows.push(row("Impact", fmtImpact(m.impact), fmtImpact(a.impact)));
      return { kind: "update", target: `Milestone ${m.id} · ${m.name}`, missing: false, rows };
    }
    case "release_create":
      return { kind: "create", target: "New release", missing: false, rows: [row("Name", null, a.name), row("Month", null, a.month), row("Ships", null, fmtList(a.milestoneIds)), row("Criteria", null, fmtCriteria(a.criteria))] };
    case "release_update": {
      const r = state.releases?.[proj ?? ""]?.find((x) => x.id === a.rid);
      if (!r) return gone(`Release ${a.rid}`);
      const rows: DiffRow[] = [];
      if (a.name !== undefined) rows.push(row("Name", r.name, a.name));
      if (a.month !== undefined) rows.push(row("Month", r.month, a.month));
      if (a.milestoneIds !== undefined) rows.push(row("Ships", fmtList(r.milestoneIds), fmtList(a.milestoneIds)));
      if (a.criteria !== undefined) rows.push(row("Criteria", fmtCriteria(r.criteria), fmtCriteria(a.criteria)));
      return { kind: "update", target: `Release ${r.id} · ${r.name}`, missing: false, rows };
    }
  }
};

// ---- evidence -------------------------------------------------------------

const foldText = (s: string): string => s.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\u2013\u2014]/g, "-").replace(/\s+/g, " ").trim();

/**
 * Whether a quoted passage appears verbatim in a source, ignoring case,
 * whitespace runs, and curly quotes. A quote shorter than a few words is
 * never treated as verification: it would match almost anything.
 */
export const quoteAppearsIn = (quote: string, text: string): boolean => {
  const q = foldText(quote);
  if (q.length < 12) return false;
  return foldText(text).includes(q);
};

/** Build the evidence record for a proposal from what a proposer cited, verifying the quote against the named source (or any source when the name does not match). */
export const evidenceFor = (source: string | null | undefined, quote: string | null | undefined, sources: readonly { name: string; text: string }[]): ProposalEvidence | null => {
  const src = source?.trim() ? source.trim().slice(0, 200) : null;
  const q = quote?.trim() ? quote.trim().slice(0, 600) : null;
  if (!src && !q) return null;
  const named = src ? sources.filter((s) => s.name.toLowerCase() === src.toLowerCase()) : [];
  const pool = named.length ? named : sources;
  const verified = q !== null && pool.some((s) => quoteAppearsIn(q, s.text));
  return { source: src, quote: q, verified };
};
