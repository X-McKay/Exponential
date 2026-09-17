// ================= template drift =================
//
// A project that follows a template can fall behind it: the template gains a
// required document, or the project was created before the template asked
// for one. Drift is derived (templates.ts in the domain package); what this
// module adds is the backfill, staged as ordinary governance-item proposals
// attributed to the setup agent, so a person decides what the project
// actually carries. Nothing is applied here.

import type { Database } from "bun:sqlite";
import { templateDrift } from "@valueflow/domain";
import type { AgentRun, Proposal, TemplateDrift } from "@valueflow/domain";
import { nextStoredProposalId, nextStoredRunId } from "./ids.ts";
import { registerProposalGuard } from "./proposal-guard.ts";
import { Conflict, currentTemplateVersion, findProject, insertProposal, insertRun, loadState, upsertProject } from "./repo.ts";

export interface DriftResult {
  drift: TemplateDrift;
  /** The run the proposals are attributed to; null when nothing needed staging. */
  run: AgentRun | null;
  proposals: Proposal[];
  /** Required items that were already waiting in the inbox and were not staged again. */
  alreadyStaged: number;
}

/**
 * Stage a governance-item proposal for every required template item the
 * project lacks. Linking the project to a template first is optional; a
 * project that follows no template is refused. Idempotent: an item with a
 * pending proposal is skipped.
 */
export const stageTemplateDrift = (db: Database, pid: string, now: Date, options: { template?: string } = {}): DriftResult => db.transaction(() => {
  let state = loadState(db, now);
  let project = findProject(state, pid);
  if (options.template !== undefined) {
    if (!state.templates?.some((t) => t.id === options.template)) throw new Conflict(`template ${options.template} not found`);
    if (project.template?.id !== options.template) {
      const { milestones: _m, historicalMilestones: _h, governance: _g, template: _t, ...own } = project;
      void _m; void _h; void _g; void _t;
      upsertProject(db, { ...own, template: { id: options.template, version: currentTemplateVersion(db, options.template) } }, "update");
      state = loadState(db, now);
      project = findProject(state, pid);
    }
  }
  const template = project.template ? state.templates?.find((t) => t.id === project.template?.id) : undefined;
  if (!template) throw new Conflict(project.template ? `template ${project.template.id} no longer exists; link the project to another template` : "the project follows no template; choose one first");
  const drift = templateDrift(project, template, state.templateVersions ?? []);
  const pendingNames = new Set(state.proposals.filter((p) => p.state === "pending" && p.proj === project.id && p.action.type === "governance_item").map((p) => (p.action.type === "governance_item" ? p.action.name.toLowerCase() : "")));
  const toStage = drift.missingRequired.filter((i) => !pendingNames.has(i.name.toLowerCase()));
  const alreadyStaged = drift.missingRequired.length - toStage.length;
  if (toStage.length === 0) return { drift, run: null, proposals: [], alreadyStaged };
  const setup = state.agents.find((a) => a.kind === "setup");
  if (!setup) throw new Conflict("no setup agent is installed; add one on the Agents page");
  const at = now.toISOString();
  const version = drift.current === null ? "" : ` v${drift.current}`;
  const run: AgentRun = {
    id: nextStoredRunId(db), agentId: setup.id, proj: project.id, tab: "governance", state: "done", startedAt: at, finishedAt: at, instruction: null,
    summary: `Template drift: ${toStage.length} required item${toStage.length === 1 ? "" : "s"} from ${template.name}${version} missing on ${project.name}`.slice(0, 140),
    output: [`## Required by the ${template.name} template${version}`, "", ...toStage.map((i) => `- ${i.name} (${i.cat}): ${i.detail}`), "", "Each item is staged as a proposal; accepting one adds it to the project as Missing so it can be tracked."].join("\n"),
    model: null, error: null, promptVersion: null, latencyMs: 0, promptTokens: null, completionTokens: null, benchmark: null, rating: null, ratingNote: null,
  };
  insertRun(db, run);
  const proposals: Proposal[] = [];
  for (const i of toStage) {
    const proposal: Proposal = {
      id: nextStoredProposalId(db), runId: run.id, agentId: setup.id, proj: project.id, ruleId: null,
      action: { type: "governance_item", cat: i.cat, name: i.name, status: "missing", owner: state.workspace.user.ini, detail: i.detail },
      rationale: `Required by the ${template.name} template${version}; the project has no ${i.kind} by this name.`,
      state: "pending", createdAt: at, decidedAt: null,
      evidence: { source: `template:${template.id}`, quote: i.detail, verified: true },
    };
    insertProposal(db, proposal);
    registerProposalGuard(db, proposal, state);
    proposals.push(proposal);
  }
  return { drift, run, proposals, alreadyStaged };
})();

/** After a template changes, re-check every project that follows it. Projects without a setup agent to attribute to are skipped rather than failing the save. */
export const restageAfterTemplateChange = (db: Database, templateIds: string[], now: Date): Proposal[] => {
  if (templateIds.length === 0) return [];
  const state = loadState(db, now);
  const out: Proposal[] = [];
  for (const p of state.projects) {
    if (!p.template || !templateIds.includes(p.template.id)) continue;
    try {
      out.push(...stageTemplateDrift(db, p.id, now).proposals);
    } catch (e) {
      if (!(e instanceof Conflict)) throw e;
    }
  }
  return out;
};
