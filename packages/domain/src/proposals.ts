// ================= proposals (derived helpers) =================

import { GSTATUS_LABEL, STATUS_LABEL } from "./labels.ts";
import type { AppState, Proposal, ProposalAction } from "./types.ts";

export const pendingProposals = (state: Pick<AppState, "proposals">, proj?: string): Proposal[] =>
  state.proposals.filter((p) => p.state === "pending" && (proj === undefined || p.proj === proj));

/** One line saying what accepting the proposal would do. */
export const describeAction = (a: ProposalAction, state: Pick<AppState, "projects">, proj: string): string => {
  const p = state.projects.find((x) => x.id === proj);
  switch (a.type) {
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
  }
};

/** Next proposal id: prop-<n>. */
export const nextProposalId = (proposals: Pick<Proposal, "id">[]): string => {
  const nums = proposals.map((r) => parseInt((r.id.match(/\d+/) ?? ["0"])[0] ?? "0", 10));
  return `prop-${Math.max(0, ...nums) + 1}`;
};
