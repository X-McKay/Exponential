// ================= workspace export and import =================
//
// One JSON document carries a whole workspace: the facts people entered, the
// documents mirrored from external systems, recent runs, and what is waiting
// in the inbox. Nothing secret (no provider credentials, no access tokens)
// and nothing derived. Importing writes through the same repository functions
// the editors use, so events append and guards are registered against the
// imported facts; it lands only in an empty workspace unless told to replace.

import type { Database } from "bun:sqlite";
import type { AppState, Proposal } from "@valueflow/domain";
import { WORKSPACE_EXPORT_FORMAT, WORKSPACE_EXPORT_VERSION } from "@valueflow/shared";
import type { WorkspaceExport, WorkspaceImportInput } from "@valueflow/shared";
import { listMembers } from "./identity.ts";
import { recordDecisionActor, registerProposalGuard } from "./proposal-guard.ts";
import { Conflict, createGovernanceItem, insertProposal, insertRule, insertRun, loadState, recordEvent, recordReading, setAgents, setBudgets, setTemplates, setWorkspace, upsertCalendarEvent, upsertMilestone, upsertProject, upsertRelease } from "./repo.ts";

interface ReadingRow {
  milestone_id: string;
  metric_id: string;
  value: number;
  recorded_at: string;
  source: "eval" | "manual";
}

/** The whole workspace as one document. */
export const exportWorkspace = (db: Database, now: Date): WorkspaceExport => {
  const s: AppState = loadState(db, now);
  return {
    format: WORKSPACE_EXPORT_FORMAT,
    version: WORKSPACE_EXPORT_VERSION,
    exportedAt: now.toISOString(),
    workspace: { user: { name: s.workspace.user.name, ini: s.workspace.user.ini } },
    members: listMembers(db).map((m) => ({ id: m.id, name: m.name, ini: m.ini, role: m.role })),
    projects: s.projects.map((p) => ({
      id: p.id, key: p.key, name: p.name, stage: p.stage, description: p.description, tier: p.tier, committee: p.committee,
      repos: p.repos.map((r) => ({ name: r.name, url: r.url })),
      team: p.team.map((t) => ({ ini: t.ini, name: t.name, role: t.role })),
      targets: { ...p.targets },
      template: p.template ? { id: p.template.id, version: p.template.version } : null,
      milestones: p.milestones.map((m) => ({ id: m.id, name: m.name, status: m.status, month: m.month, impact: structuredClone(m.impact), metrics: m.metrics.map((x) => ({ id: x.id, label: x.label, base: x.base, stretch: x.stretch, current: x.current })) })),
      governance: p.governance.map((g) => ({ id: g.id, cat: g.cat, name: g.name, status: g.status, owner: g.owner, date: g.date, detail: g.detail, ...(g.link ? { link: g.link } : {}) })),
      releases: (s.releases[p.id] ?? []).map((r) => ({ id: r.id, name: r.name, month: r.month, milestoneIds: [...r.milestoneIds], criteria: structuredClone(r.criteria) })),
      readings: db
        .query<ReadingRow, [string]>("SELECT r.milestone_id, r.metric_id, r.value, r.recorded_at, r.source FROM metric_readings r JOIN milestones m ON m.project_id = r.project_id AND m.id = r.milestone_id JOIN metrics x ON x.project_id = r.project_id AND x.milestone_id = r.milestone_id AND x.id = r.metric_id WHERE r.project_id = ? AND m.retired_at IS NULL AND x.retired_at IS NULL ORDER BY r.recorded_at, r.seq")
        .all(p.id)
        .map((r) => ({ milestoneId: r.milestone_id, metricId: r.metric_id, value: r.value, recordedAt: r.recorded_at, source: r.source })),
    })),
    calendar: s.calendar.map((c) => ({ id: c.id, date: c.date, proj: c.proj, tab: c.tab, text: c.text, sub: c.sub })),
    agents: s.agents.map((a) => ({ id: a.id, name: a.name, grad: a.grad, purpose: a.purpose, kind: a.kind, model: a.model, owner: a.owner, caps: [...a.caps], schedule: a.schedule, prompt: a.prompt })),
    templates: structuredClone(s.templates ?? []),
    rules: s.rules.map((r) => ({ id: r.id, text: r.text, proj: r.proj, enabled: r.enabled, auto: r.auto, owner: r.owner, createdAt: r.createdAt })),
    budgets: s.budgets.map((b) => ({ scope: b.scope, ref: b.ref, monthlyTokens: b.monthlyTokens, monthlyUsd: b.monthlyUsd })),
    runs: s.runs.map((r) => ({ id: r.id, agentId: r.agentId, proj: r.proj, tab: r.tab, state: r.state, startedAt: r.startedAt, finishedAt: r.finishedAt, instruction: r.instruction, summary: r.summary, output: r.output, model: r.model, error: r.error, promptVersion: r.promptVersion, latencyMs: r.latencyMs, promptTokens: r.promptTokens, completionTokens: r.completionTokens, benchmark: r.benchmark, rating: r.rating, ratingNote: r.ratingNote })),
    proposals: s.proposals.map((p) => ({ id: p.id, runId: p.runId, agentId: p.agentId, proj: p.proj, ruleId: p.ruleId, action: p.action, rationale: p.rationale, state: p.state, createdAt: p.createdAt, decidedAt: p.decidedAt, decidedBy: p.decidedBy ?? null, decisionMode: p.decisionMode ?? null, evidence: p.evidence ?? null })),
    events: s.events.map((e) => ({ ref: e.ref, at: e.at, type: e.type, proj: e.proj, tab: e.tab, text: e.text })),
  };
};

export interface ImportSummary {
  replaced: boolean;
  projects: number;
  milestones: number;
  governance: number;
  releases: number;
  readings: number;
  calendar: number;
  agents: number;
  templates: number;
  rules: number;
  runs: number;
  proposals: number;
  events: number;
  members: number;
  /** Runs or proposals left out because what they reference (an agent, a run, a project) is not in the document. */
  skipped: number;
}

/**
 * Write a document into this workspace. Refused when projects already exist
 * unless `replace` is set, which removes every project, run, proposal, rule,
 * budget, and calendar event first. Members, templates, and agents are merged
 * by id. All or nothing: a failure part-way leaves the workspace as it was.
 */
export const importWorkspace = (db: Database, input: WorkspaceImportInput, now: Date): ImportSummary => db.transaction(() => {
  const doc = input.document;
  const existing = db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM projects").get()?.n ?? 0;
  if (existing > 0 && !input.replace) throw new Conflict(`this workspace already has ${existing} project${existing === 1 ? "" : "s"}; import into an empty workspace or choose to replace it`);
  if (input.replace) {
    for (const table of ["proposals", "agent_runs", "rules", "budgets", "calendar_events", "events", "setup_drafts", "projects"]) db.query(`DELETE FROM ${table}`).run();
  }
  const summary: ImportSummary = { replaced: input.replace, projects: 0, milestones: 0, governance: 0, releases: 0, readings: 0, calendar: 0, agents: doc.agents.length, templates: doc.templates.length, rules: 0, runs: 0, proposals: 0, events: 0, members: 0, skipped: 0 };

  setWorkspace(db, doc.workspace);
  const members = listMembers(db);
  for (const m of doc.members) {
    if (members.some((x) => x.id === m.id || x.ini === m.ini)) continue;
    db.query("INSERT INTO workspace_members (id, name, ini, role) VALUES (?,?,?,?)").run(m.id, m.name, m.ini, m.role);
    summary.members += 1;
  }
  setAgents(db, doc.agents);
  setTemplates(db, doc.templates, now);
  const agentIds = new Set(doc.agents.map((a) => a.id));
  const projectIds = new Set(doc.projects.map((p) => p.id));

  for (const p of doc.projects) {
    const { milestones, governance, releases, readings, ...own } = p;
    upsertProject(db, own, "create");
    summary.projects += 1;
    // Readings are appended afterwards with their original instants, so definitions start with no reading.
    for (const m of milestones) {
      upsertMilestone(db, p.id, { ...m, metrics: m.metrics.map((x) => ({ ...x, current: 0 })) }, "create", now);
      summary.milestones += 1;
    }
    for (const g of governance) {
      createGovernanceItem(db, p.id, g);
      summary.governance += 1;
    }
    for (const r of releases) {
      upsertRelease(db, p.id, r, "create");
      summary.releases += 1;
    }
    for (const r of readings) {
      if (!milestones.some((m) => m.id === r.milestoneId && m.metrics.some((x) => x.id === r.metricId))) {
        summary.skipped += 1;
        continue;
      }
      recordReading(db, p.id, r.milestoneId, r.metricId, r.value, r.source, new Date(r.recordedAt), false);
      summary.readings += 1;
    }
  }
  for (const c of doc.calendar) {
    if (!projectIds.has(c.proj)) { summary.skipped += 1; continue; }
    upsertCalendarEvent(db, c, "create");
    summary.calendar += 1;
  }
  for (const r of doc.rules) {
    if (r.proj !== null && !projectIds.has(r.proj)) { summary.skipped += 1; continue; }
    insertRule(db, { id: r.id, text: r.text, proj: r.proj, enabled: r.enabled, auto: r.auto, owner: r.owner, createdAt: r.createdAt });
    summary.rules += 1;
  }
  setBudgets(db, doc.budgets.filter((b) => b.scope === "workspace" || (b.scope === "agent" ? agentIds.has(b.ref) : projectIds.has(b.ref))));
  const runIds = new Set<string>();
  for (const r of doc.runs) {
    if (!agentIds.has(r.agentId) || (r.proj !== null && !projectIds.has(r.proj))) { summary.skipped += 1; continue; }
    insertRun(db, { ...r, state: r.state === "working" || r.state === "queued" ? "failed" : r.state, error: r.state === "working" || r.state === "queued" ? "interrupted before export" : r.error });
    runIds.add(r.id);
    summary.runs += 1;
  }
  for (const e of doc.events) {
    if (!projectIds.has(e.proj)) { summary.skipped += 1; continue; }
    recordEvent(db, e);
    summary.events += 1;
  }
  // Guards are registered against the imported facts, so a pending proposal stays acceptable exactly when its target still reads as exported.
  const state = loadState(db, now);
  for (const p of doc.proposals) {
    if (!runIds.has(p.runId) || !agentIds.has(p.agentId) || (p.proj !== null && !projectIds.has(p.proj))) { summary.skipped += 1; continue; }
    const proposal: Proposal = { id: p.id, runId: p.runId, agentId: p.agentId, proj: p.proj, ruleId: p.ruleId, action: p.action, rationale: p.rationale, state: p.state, createdAt: p.createdAt, decidedAt: p.decidedAt, evidence: p.evidence ?? null };
    insertProposal(db, proposal);
    registerProposalGuard(db, proposal, state);
    if (p.state !== "pending" && p.decidedBy) recordDecisionActor(db, proposal, p.decidedBy, p.decisionMode ?? "human");
    summary.proposals += 1;
  }
  return summary;
})();
