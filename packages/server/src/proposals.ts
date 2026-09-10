// ================= proposals =================
//
// An agent may propose a change to facts; nothing happens until a person
// accepts it. Accepting applies the change through the same repository
// functions the editors use, so events are appended and derivations follow.

import type { Database } from "bun:sqlite";
import { slugId } from "@valueflow/domain";
import type { Proposal } from "@valueflow/domain";
import {
  NotFound,
  createGovernanceItem,
  findMilestone,
  findProject,
  loadState,
  setTargets,
  updateGovernance,
  updateProposal,
  upsertCalendarEvent,
  upsertMilestone,
} from "./repo.ts";

export class ProposalRejected extends Error {
  override name = "ProposalRejected";
}

/** Apply a pending proposal and mark it accepted. Throws ProposalRejected when the target no longer exists. */
export const acceptProposal = (db: Database, proposal: Proposal, now: Date): Proposal => {
  if (proposal.state !== "pending") throw new ProposalRejected(`proposal ${proposal.id} is already ${proposal.state}`);
  const state = loadState(db, now);
  const project = findProject(state, proposal.proj);
  const a = proposal.action;
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
  }
  const accepted: Proposal = { ...proposal, state: "accepted", decidedAt: now.toISOString() };
  updateProposal(db, accepted);
  return accepted;
};

export const dismissProposal = (db: Database, proposal: Proposal, now: Date): Proposal => {
  if (proposal.state !== "pending") throw new ProposalRejected(`proposal ${proposal.id} is already ${proposal.state}`);
  const dismissed: Proposal = { ...proposal, state: "dismissed", decidedAt: now.toISOString() };
  updateProposal(db, dismissed);
  return dismissed;
};

export const findProposal = (db: Database, id: string, now: Date): Proposal => {
  const p = loadState(db, now).proposals.find((x) => x.id === id);
  if (!p) throw new NotFound(`proposal ${id} not found`);
  return p;
};
