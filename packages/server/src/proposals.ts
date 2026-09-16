import { currentRuleStats, proposalIsCurrent, recordDecisionActor } from "./proposal-guard.ts";
// ================= proposals =================
//
// An agent may propose a change to facts; nothing happens until a person
// accepts it. Accepting applies the change through the same repository
// functions the editors use, so events are appended and derivations follow.

import type { Database } from "bun:sqlite";
import { nextMilestoneId, nextReleaseId, slugId } from "@valueflow/domain";
import type { Proposal } from "@valueflow/domain";
import type { ProjectInput } from "@valueflow/shared";
import { promptVersion } from "./prompts.ts";
import {
  NotFound,
  createGovernanceItem,
  findMilestone,
  findProject,
  loadState,
  setAgentModel,
  setAgentPrompt,
  setTargets,
  updateGovernance,
  updateProposal,
  upsertCalendarEvent,
  upsertMilestone,
  upsertProject,
  upsertRelease,
} from "./repo.ts";

export class ProposalRejected extends Error {
  override name = "ProposalRejected";
}

/** Apply a pending proposal and mark it accepted. Throws ProposalRejected when the target no longer exists. */
export const acceptProposal = (db: Database, proposal: Proposal, now: Date, mode: "human" | "automatic" = "human"): Proposal => db.transaction(() => {
  proposal = findProposal(db, proposal.id, now);
  if (proposal.state !== "pending") throw new ProposalRejected(`proposal ${proposal.id} is already ${proposal.state}`);
  if (now.getTime() - new Date(proposal.createdAt).getTime() > 7 * 86_400_000) throw new ProposalRejected("proposal expired; request a fresh proposal");
  const state = loadState(db, now);
  const a = proposal.action;
  // Check existence first so deletion is distinguishable from an intervening edit.
  if (proposal.proj && !state.projects.some((p) => p.id === proposal.proj)) throw new ProposalRejected("project no longer exists");
  if (a.type === "governance_status" && !state.projects.find((p) => p.id === proposal.proj)?.governance.some((g) => g.id === a.gid)) throw new ProposalRejected("governance item no longer exists");
  if (a.type === "milestone_status" && !state.projects.find((p) => p.id === proposal.proj)?.milestones.some((m) => m.id === a.mid)) throw new ProposalRejected("milestone no longer exists");
  if (a.type === "governance_update" && !state.projects.find((p) => p.id === proposal.proj)?.governance.some((g) => g.id === a.gid)) throw new ProposalRejected("governance item no longer exists");
  if (a.type === "milestone_update" && !state.projects.find((p) => p.id === proposal.proj)?.milestones.some((m) => m.id === a.mid)) throw new ProposalRejected("milestone no longer exists");
  if (a.type === "release_update" && !(state.releases[proposal.proj ?? ""] ?? []).some((r) => r.id === a.rid)) throw new ProposalRejected("release no longer exists");
  if (!proposalIsCurrent(db, proposal, state)) throw new ProposalRejected("proposal is stale or predates evidence checks; dismiss it and request a fresh proposal");
  if (mode === "automatic") {
    const rule = state.rules.find((r) => r.id === proposal.ruleId);
    if (!rule?.enabled || !rule.auto || (rule.proj !== null && rule.proj !== proposal.proj) || !currentRuleStats(db, rule, state.proposals).earnedAutonomy || a.type !== "calendar_event") {
      throw new ProposalRejected("automatic actions require an eligible rule and are limited to calendar reminders; other changes require a person");
    }
  }
  const actor = mode === "automatic" ? `agent:${proposal.agentId}` : state.workspace.user.ini;

  if (a.type === "agent_prompt" || a.type === "agent_model") {
    const agent = state.agents.find((x) => x.id === a.agentId);
    if (!agent) throw new ProposalRejected(`agent ${a.agentId} no longer exists`);
    if (a.type === "agent_prompt") setAgentPrompt(db, agent.id, a.prompt, promptVersion(agent.kind, a.prompt, agent.id), proposal.agentId === agent.id ? "person" : "tuner", now.toISOString());
    else setAgentModel(db, agent.id, a.model);
    const accepted: Proposal = { ...proposal, state: "accepted", decidedAt: now.toISOString() };
    updateProposal(db, accepted);
    recordDecisionActor(db, accepted, actor, mode);
    return accepted;
  }
  if (!proposal.proj) throw new ProposalRejected(`proposal ${proposal.id} names no project`);
  const project = findProject(state, proposal.proj);
  switch (a.type) {
    case "governance_status": {
      const g = project.governance.find((x) => x.id === a.gid);
      if (!g) throw new ProposalRejected(`governance item ${a.gid} no longer exists`);
      updateGovernance(db, project.id, g.id, { status: a.status, owner: g.owner, date: g.date, detail: g.detail, ...(g.link ? { link: g.link } : {}) }, now);
      break;
    }
    case "milestone_status": {
      const m = findMilestone(state, project.id, a.mid);
      upsertMilestone(db, project.id, { ...m, status: a.status }, "update", now);
      break;
    }
    case "governance_item":
      createGovernanceItem(db, project.id, {
        id: slugId(a.name, project.governance.map((g) => g.id), "item"),
        cat: a.cat,
        name: a.name,
        status: a.status,
        owner: a.owner,
        date: null,
        detail: a.detail,
      });
      break;
    case "calendar_event":
      upsertCalendarEvent(db, { id: slugId(a.text, state.calendar.map((c) => c.id), "event"), date: a.date, proj: project.id, tab: a.tab, text: a.text, sub: a.sub }, "create");
      break;
    case "targets":
      setTargets(db, project.id, { fte: a.fte, time: a.time });
      break;
    case "project_details":
    case "team_member":
    case "repo": {
      const input: ProjectInput = { id: project.id, key: project.key, name: project.name, stage: project.stage, description: project.description, tier: project.tier, committee: project.committee, repos: project.repos.map((r) => ({ ...r })), team: project.team.map((t) => ({ ...t })), targets: { ...project.targets } };
      if (a.type === "project_details") {
        if (a.description !== undefined) input.description = a.description;
        if (a.stage !== undefined) input.stage = a.stage;
        if (a.tier !== undefined) input.tier = a.tier;
        if (a.committee !== undefined) input.committee = a.committee;
      } else if (a.type === "team_member") {
        const i = input.team.findIndex((t) => t.ini === a.ini);
        if (i >= 0) input.team[i] = { ini: a.ini, name: a.name, role: a.role };
        else input.team.push({ ini: a.ini, name: a.name, role: a.role });
      } else {
        const i = input.repos.findIndex((r) => r.name === a.name);
        if (i >= 0) input.repos[i] = { name: a.name, url: a.url };
        else input.repos.push({ name: a.name, url: a.url });
      }
      upsertProject(db, input, "update");
      break;
    }
    case "governance_update": {
      const g = project.governance.find((x) => x.id === a.gid);
      if (!g) throw new ProposalRejected(`governance item ${a.gid} no longer exists`);
      updateGovernance(db, project.id, g.id, { status: a.status ?? g.status, owner: a.owner ?? g.owner, date: a.date === undefined ? g.date : a.date, detail: a.detail ?? g.detail, ...(g.link ? { link: g.link } : {}) }, now);
      break;
    }
    case "milestone_create": {
      if (project.milestones.some((m) => m.name.toLowerCase() === a.name.toLowerCase())) throw new ProposalRejected(`a milestone named "${a.name}" already exists`);
      const taken: string[] = [];
      upsertMilestone(db, project.id, {
        id: nextMilestoneId({ milestones: [...project.milestones, ...(project.historicalMilestones ?? [])] }),
        name: a.name,
        status: a.status,
        month: a.month,
        impact: a.impact,
        metrics: a.metrics.map((x, i) => {
          const id = slugId(x.label, taken, `m${i + 1}`).slice(0, 24);
          taken.push(id);
          return { id, label: x.label, base: x.base, stretch: x.stretch, current: 0 };
        }),
      }, "create", now);
      break;
    }
    case "milestone_update": {
      const m = findMilestone(state, project.id, a.mid);
      upsertMilestone(db, project.id, { ...m, name: a.name ?? m.name, status: a.status ?? m.status, month: a.month ?? m.month, impact: a.impact ?? m.impact }, "update", now);
      break;
    }
    case "release_create": {
      const releases = state.releases[project.id] ?? [];
      if (releases.some((r) => r.name.toLowerCase() === a.name.toLowerCase())) throw new ProposalRejected(`a release named "${a.name}" already exists`);
      checkReleaseRefs(project, a.milestoneIds, a.criteria);
      upsertRelease(db, project.id, { id: nextReleaseId(releases), name: a.name, month: a.month, milestoneIds: a.milestoneIds, criteria: a.criteria }, "create");
      break;
    }
    case "release_update": {
      const rel = (state.releases[project.id] ?? []).find((r) => r.id === a.rid);
      if (!rel) throw new ProposalRejected(`release ${a.rid} no longer exists`);
      const next = { ...rel, name: a.name ?? rel.name, month: a.month ?? rel.month, milestoneIds: a.milestoneIds ?? rel.milestoneIds, criteria: a.criteria ?? rel.criteria };
      checkReleaseRefs(project, next.milestoneIds, next.criteria);
      upsertRelease(db, project.id, next, "update");
      break;
    }
  }
  const accepted: Proposal = { ...proposal, state: "accepted", decidedAt: now.toISOString() };
  updateProposal(db, accepted);
  recordDecisionActor(db, accepted, actor, mode);
  return accepted;
})();

/** A release may only point at milestones and governance items the project currently has. */
const checkReleaseRefs = (project: { milestones: { id: string }[]; governance: { id: string }[] }, milestoneIds: string[], criteria: { type: string; ms?: string; gid?: string }[]): void => {
  for (const mid of milestoneIds) if (!project.milestones.some((m) => m.id === mid)) throw new ProposalRejected(`milestone ${mid} no longer exists`);
  for (const c of criteria) {
    if (c.type === "gate" && !project.milestones.some((m) => m.id === c.ms)) throw new ProposalRejected(`milestone ${c.ms} no longer exists`);
    if (c.type === "gov" && !project.governance.some((g) => g.id === c.gid)) throw new ProposalRejected(`governance item ${c.gid} no longer exists`);
  }
};

export const dismissProposal = (db: Database, proposal: Proposal, now: Date): Proposal => db.transaction(() => {
  proposal = findProposal(db, proposal.id, now);
  if (proposal.state !== "pending") throw new ProposalRejected(`proposal ${proposal.id} is already ${proposal.state}`);
  const dismissed: Proposal = { ...proposal, state: "dismissed", decidedAt: now.toISOString() };
  updateProposal(db, dismissed);
  recordDecisionActor(db, dismissed, loadState(db, now).workspace.user.ini, "human");
  return dismissed;
})();

export const findProposal = (db: Database, id: string, now: Date): Proposal => {
  const p = loadState(db, now).proposals.find((x) => x.id === id);
  if (!p) throw new NotFound(`proposal ${id} not found`);
  return p;
};
