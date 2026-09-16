// ================= proposals (derived helpers) =================

import { GSTATUS_LABEL, STATUS_LABEL, TIER_LABEL } from "./labels.ts";
import type { AppState, Proposal, ProposalAction, Rule } from "./types.ts";

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
