import type { Database } from "bun:sqlite";
import { ruleStats } from "@valueflow/domain";
import type { AppState, Proposal, Rule, RuleStats } from "@valueflow/domain";

/** Only facts relevant to the proposed change; unrelated decisions may proceed. */
export const proposalBasis = (p: Proposal, state: AppState): string => {
  const project = state.projects.find((x) => x.id === p.proj);
  const a = p.action;
  let target: unknown;
  switch (a.type) {
    case "agent_prompt":
    case "agent_model":
      target = state.agents.find((x) => x.id === a.agentId) ?? null;
      break;
    case "governance_status": target = project?.governance.find((g) => g.id === a.gid) ?? null; break;
    case "milestone_status": target = project?.milestones.find((m) => m.id === a.mid) ?? null; break;
    case "targets": target = project?.targets ?? null; break;
    case "governance_item": target = project ? { project: project.id, duplicates: project.governance.filter((g) => g.name.toLowerCase() === a.name.toLowerCase()) } : null; break;
    case "calendar_event": target = project ? { project: project.id, duplicates: state.calendar.filter((c) => c.proj === project.id && c.date === a.date && c.text === a.text) } : null; break;
    // Record edits guard only the fields they would overwrite, so an unrelated
    // reading or snapshot never makes a document-backed change stale.
    case "project_details": target = project ? { description: project.description, stage: project.stage, tier: project.tier, committee: project.committee } : null; break;
    case "team_member": target = project ? { member: project.team.find((t) => t.ini === a.ini) ?? null } : null; break;
    case "repo": target = project ? { repo: project.repos.find((r) => r.name === a.name) ?? null } : null; break;
    case "governance_update": { const g = project?.governance.find((x) => x.id === a.gid); target = g ? { status: g.status, owner: g.owner, date: g.date, detail: g.detail } : null; break; }
    case "milestone_create": target = project ? { project: project.id, duplicates: project.milestones.filter((m) => m.name.toLowerCase() === a.name.toLowerCase()).map((m) => m.id) } : null; break;
    case "milestone_update": { const m = project?.milestones.find((x) => x.id === a.mid); target = m ? { name: m.name, status: m.status, month: m.month, impact: m.impact } : null; break; }
    case "release_create": target = project ? { project: project.id, duplicates: (state.releases[project.id] ?? []).filter((r) => r.name.toLowerCase() === a.name.toLowerCase()).map((r) => r.id) } : null; break;
    case "release_update": target = project ? ((state.releases[project.id] ?? []).find((r) => r.id === a.rid) ?? null) : null; break;
  }
  const rule = p.ruleId ? state.rules.find((r) => r.id === p.ruleId) ?? null : null;
  return JSON.stringify({ target, rule });
};

export const registerProposalGuard = (db: Database, p: Proposal, briefingState: AppState): void => {
  db.query("INSERT INTO proposal_guards (proposal_id, expected) VALUES (?, ?)").run(p.id, proposalBasis(p, briefingState));
};

export const proposalIsCurrent = (db: Database, p: Proposal, state: AppState): boolean => {
  const guard = db.query<{ expected: string }, [string]>("SELECT expected FROM proposal_guards WHERE proposal_id = ?").get(p.id);
  return guard !== null && guard.expected === proposalBasis(p, state);
};

/** Count only decisions made while this exact rule text and scope were active. */
export const currentRuleStats = (db: Database, rule: Rule, proposals: Proposal[]): RuleStats => {
  const matching = proposals.filter((p) => {
    if (p.ruleId !== rule.id || p.decisionMode === "automatic") return false;
    const guard = db.query<{ expected: string }, [string]>("SELECT expected FROM proposal_guards WHERE proposal_id = ?").get(p.id);
    if (!guard?.expected) return false;
    try {
      const basis = JSON.parse(guard.expected) as { rule?: Rule };
      return basis.rule?.text === rule.text && basis.rule?.proj === rule.proj;
    } catch {
      return false;
    }
  });
  return ruleStats(rule, matching);
};

export const recordDecisionActor = (db: Database, p: Proposal, actor: string, mode: "human" | "automatic"): void => {
  // Preserve the original expected snapshot when recording the decision.
  const expected = db.query<{ expected: string }, [string]>("SELECT expected FROM proposal_guards WHERE proposal_id = ?").get(p.id)?.expected ?? "";
  db.query("INSERT INTO proposal_guards (proposal_id, expected, decided_by, decision_mode) VALUES (?, ?, ?, ?) ON CONFLICT(proposal_id) DO UPDATE SET decided_by = excluded.decided_by, decision_mode = excluded.decision_mode").run(p.id, expected, actor, mode);
};
