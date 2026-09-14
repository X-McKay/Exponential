import type { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { Conflict, NotFound, loadState } from "./repo.ts";
import { runAgent } from "./agents.ts";
import type { Llm } from "./llm.ts";
import type { PMAssignment, PMAssignmentCreate, PMAssignmentUpdate, PMCommitment, PMRun } from "@valueflow/shared";

const fingerprint = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
type AssignmentRow = { id: string; project_id: string; objective: string; enabled: number; on_change: number; cadence: "weekly" | "manual"; owner: string; created_at: string; updated_at: string; last_input_fingerprint: string | null };
type CommitmentRow = { id: string; title: string; owner: string; due: string | null; status: PMCommitment["status"]; created_at: string; updated_at: string };
type RunRow = { id: string; assignment_id: string; project_id: string; agent_run_id: string | null; trigger: PMRun["trigger"]; input_fingerprint: string; state: PMRun["state"]; summary: string; output: string; error: string | null; started_at: string; finished_at: string | null };
const rows = (db: Database, assignmentId?: string): AssignmentRow[] => db.query<AssignmentRow, string[]>(assignmentId ? "SELECT * FROM pm_assignments WHERE id = ?" : "SELECT * FROM pm_assignments ORDER BY created_at").all(...(assignmentId ? [assignmentId] : []));
const commitments = (db: Database, id: string): PMCommitment[] => db.query<CommitmentRow, [string]>("SELECT * FROM pm_commitments WHERE assignment_id = ? ORDER BY created_at, id").all(id).map((r) => ({ id: r.id, title: r.title, owner: r.owner, due: r.due, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at }));
const toAssignment = (db: Database, r: AssignmentRow): PMAssignment => ({ id: r.id, projectId: r.project_id, objective: r.objective, enabled: r.enabled === 1, onChange: r.on_change === 1, cadence: r.cadence, owner: r.owner, commitments: commitments(db, r.id), createdAt: r.created_at, updatedAt: r.updated_at, lastInputFingerprint: r.last_input_fingerprint });
const runRow = (r: RunRow): PMRun => ({ id: r.id, assignmentId: r.assignment_id, projectId: r.project_id, agentRunId: r.agent_run_id, trigger: r.trigger, inputFingerprint: r.input_fingerprint, state: r.state, summary: r.summary, output: r.output, error: r.error, startedAt: r.started_at, finishedAt: r.finished_at });

export const listAssignments = (db: Database): PMAssignment[] => rows(db).map((r) => toAssignment(db, r));
export const getAssignment = (db: Database, id: string): PMAssignment => { const r = rows(db, id)[0]; if (!r) throw new NotFound(`PM assignment ${id} not found`); return toAssignment(db, r); };
const ensureProject = (db: Database, projectId: string): void => { if (!(db.query<{ n: number }, [string]>("SELECT COUNT(*) n FROM projects WHERE id = ?").get(projectId)?.n ?? 0)) throw new NotFound(`project ${projectId} not found`); };

export const createAssignment = (db: Database, input: PMAssignmentCreate, now: Date): PMAssignment => {
  ensureProject(db, input.projectId); const at = now.toISOString(); const id = randomUUID();
  db.transaction(() => {
    db.query("INSERT INTO pm_assignments (id,project_id,objective,enabled,on_change,cadence,owner,created_at,updated_at,last_input_fingerprint) VALUES (?,?,?,?,?,?,?,?,?,NULL)").run(id,input.projectId,input.objective,input.enabled?1:0,input.onChange?1:0,input.cadence,input.owner,at,at);
    for (const c of input.commitments) { const cid = c.id ?? randomUUID(); db.query("INSERT INTO pm_commitments (id,assignment_id,title,owner,due,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").run(cid,id,c.title,c.owner,c.due,c.status,at,at); }
  })(); return getAssignment(db, id);
};
export const updateAssignment = (db: Database, id: string, input: PMAssignmentUpdate, now: Date): PMAssignment => {
  const current = getAssignment(db,id);
  if (input.expectedUpdatedAt && input.expectedUpdatedAt !== current.updatedAt) throw new Conflict("Assignment changed since you opened it. Refresh before saving.");
  const at = new Date(Math.max(now.getTime(), new Date(current.updatedAt).getTime() + 1)).toISOString();
  const merged = { ...current, ...input };
  db.transaction(() => {
    db.query("UPDATE pm_assignments SET objective=?,enabled=?,on_change=?,cadence=?,owner=?,updated_at=? WHERE id=?").run(merged.objective,merged.enabled?1:0,merged.onChange?1:0,merged.cadence,merged.owner,at,id);
    if (input.commitments) { const old = new Map(current.commitments.map(c => [c.id, c])); db.query("DELETE FROM pm_commitments WHERE assignment_id=?").run(id); for (const c of input.commitments) { const cid=c.id??randomUUID(); const prior=old.get(cid); db.query("INSERT INTO pm_commitments (id,assignment_id,title,owner,due,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").run(cid,id,c.title,c.owner,c.due,c.status,prior?.createdAt ?? at,at); } }
  })(); return getAssignment(db,id);
};
export const listRuns = (db: Database, id: string): PMRun[] => { getAssignment(db,id); return db.query<RunRow,[string]>("SELECT * FROM pm_runs WHERE assignment_id=? ORDER BY started_at DESC, rowid DESC").all(id).map(runRow); };

export const runAssignment = async (db: Database, llm: Llm, id: string, now: Date, trigger: "manual"|"scheduled", extra?: string): Promise<PMRun> => {
  const a = getAssignment(db,id); const state = loadState(db,now); const p = state.projects.find((x)=>x.id===a.projectId); if (!p) throw new NotFound(`project ${a.projectId} not found`);
  const dev = state.dev[a.projectId];
  const fp = fingerprint({ owner: a.owner, dev: dev ? { repos: dev.repos, prs: dev.prs, builds: dev.builds, commits: dev.commits } : null, calendar: state.calendar.filter(e => e.proj === a.projectId), objective:a.objective, commitments:a.commitments.map(({ id: commitmentId, title, owner, due, status }) => ({ id: commitmentId, title, owner, due, status })), project:p, releases:state.releases[a.projectId] ?? [] });
  const latest = listRuns(db,id)[0];
  if (latest && (latest.state === "queued" || latest.state === "working")) throw new Conflict("PM assignment is already running");
  if (trigger === "scheduled") {
    if (!a.enabled) throw new Conflict("PM assignment is paused");
    const age = latest ? now.getTime() - new Date(latest.startedAt).getTime() : Infinity;
    if (latest?.state === "failed" && age < 60 * 60_000) throw new Conflict("PM failure cooldown");
    const changed = a.onChange && a.lastInputFingerprint !== fp;
    const success = listRuns(db, id).find(r => r.state === "done" || r.state === "attention");
    const weekly = a.cadence === "weekly" && (!success || now.getTime() - new Date(success.startedAt).getTime() >= 7 * 86_400_000);
    if (!changed && !weekly) throw new Conflict("PM inputs are not due");
  }
  const prior = listRuns(db,id).find(r => r.state === "done" || r.state === "attention"); const commitmentBlock = a.commitments.length ? `Human-managed commitments (do not close automatically):\n${a.commitments.map(c => `- ${c.title} · owner ${c.owner} · due ${c.due ?? "none"} · ${c.status}`).join("\n")}` : "No commitments recorded.";
  const instruction = [a.objective, commitmentBlock, prior?.output ? `Previous PM assessment:\n${prior.output.slice(0,12000)}` : "", extra ? `Follow-up instruction:\n${extra}` : ""].filter(Boolean).join("\n\n");
  const rid=randomUUID(), at=now.toISOString(); db.query("INSERT INTO pm_runs (id,assignment_id,project_id,trigger,input_fingerprint,state,summary,output,error,started_at,finished_at) VALUES (?,?,?,?,?,'queued','Queued','',NULL,?,NULL)").run(rid,id,a.projectId,trigger,fp,at);
  try {
    db.query("UPDATE pm_runs SET state='working', summary='Preparing assessment' WHERE id=?").run(rid);
    const agentRun = await runAgent(db,llm,{agentId:"project-manager",proj:a.projectId,tab:"overview",instruction},now,{ onCreated: (r) => db.query("UPDATE pm_runs SET agent_run_id=? WHERE id=?").run(r.id,rid) });
    const done = { ...runRow(db.query<RunRow,[string]>("SELECT * FROM pm_runs WHERE id=?").get(rid)!), agentRunId:agentRun.id, state:agentRun.state, summary:agentRun.summary, output:agentRun.output, error:agentRun.error, finishedAt:agentRun.finishedAt } as PMRun;
    db.query("UPDATE pm_runs SET agent_run_id=?,state=?,summary=?,output=?,error=?,finished_at=? WHERE id=?").run(done.agentRunId,done.state,done.summary,done.output,done.error,done.finishedAt,rid);
    if (done.state === "done" || done.state === "attention") db.query("UPDATE pm_assignments SET last_input_fingerprint=? WHERE id=?").run(fp,id);
    return done;
  } catch (e) { const msg=e instanceof Error?e.message:String(e); db.query("UPDATE pm_runs SET state='failed',summary='PM run failed',error=?,finished_at=? WHERE id=?").run(msg,new Date().toISOString(),rid); return runRow(db.query<RunRow,[string]>("SELECT * FROM pm_runs WHERE id=?").get(rid)!); }
};

export const runDuePm = async (db: Database, llm: Llm, now: Date): Promise<PMRun[]> => { const out: PMRun[]=[]; for (const a of listAssignments(db)) if (a.enabled && (a.cadence === "weekly" || a.onChange)) { try { out.push(await runAssignment(db,llm,a.id,now,"scheduled")); } catch (e) { if (!(e instanceof Conflict)) console.error(`PM assignment ${a.id} failed`,e); } } return out; };
