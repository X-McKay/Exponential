import type { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { Conflict, NotFound, loadState } from "./repo.ts";
import { runAgent } from "./agents.ts";
import type { Llm } from "./llm.ts";
import type { CommsAssignment, CommsAssignmentCreate, CommsAssignmentUpdate, CommsArtifact, CommsMessage, CommsRun, CommsWorkspaceDetail } from "@valueflow/shared";

type AssignmentRow = { id: string; project_id: string; objective: string; audience: string; format: CommsAssignment["format"]; owner: string; enabled: number; on_change: number; cadence: CommsAssignment["cadence"]; created_at: string; updated_at: string; last_input_fingerprint: string | null };
type RunRow = { id: string; assignment_id: string; project_id: string; agent_run_id: string | null; trigger: CommsRun["trigger"]; mode: CommsRun["mode"]; input_fingerprint: string; state: CommsRun["state"]; summary: string; output: string; error: string | null; started_at: string; finished_at: string | null };
type MessageRow = { id: string; assignment_id: string; run_id: string; role: CommsMessage["role"]; content: string; created_at: string };
type ArtifactRow = { id: string; assignment_id: string; project_id: string; run_id: string; agent_run_id: string; title: string; format: CommsArtifact["format"]; version: number; body: string; status: CommsArtifact["status"]; approved_at: string | null; created_at: string };

const hash = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const assignment = (r: AssignmentRow): CommsAssignment => ({ id: r.id, projectId: r.project_id, objective: r.objective, audience: r.audience, format: r.format, owner: r.owner, enabled: r.enabled === 1, onChange: r.on_change === 1, cadence: r.cadence, createdAt: r.created_at, updatedAt: r.updated_at, lastInputFingerprint: r.last_input_fingerprint });
const run = (r: RunRow): CommsRun => ({ id: r.id, assignmentId: r.assignment_id, projectId: r.project_id, agentRunId: r.agent_run_id, trigger: r.trigger, mode: r.mode ?? "draft", inputFingerprint: r.input_fingerprint, state: r.state, summary: r.summary, output: r.output, error: r.error, startedAt: r.started_at, finishedAt: r.finished_at });
const message = (r: MessageRow): CommsMessage => ({ id: r.id, assignmentId: r.assignment_id, runId: r.run_id, role: r.role, content: r.content, createdAt: r.created_at });
const artifact = (r: ArtifactRow): CommsArtifact => ({ id: r.id, assignmentId: r.assignment_id, projectId: r.project_id, runId: r.run_id, agentRunId: r.agent_run_id, title: r.title, format: r.format, version: r.version, body: r.body, status: r.status, approvedAt: r.approved_at, createdAt: r.created_at });
const getAssignmentRow = (db: Database, id: string): AssignmentRow | null => db.query<AssignmentRow, [string]>("SELECT * FROM comms_assignments WHERE id=?").get(id) ?? null;
const ensureProject = (db: Database, id: string): void => { if (!db.query<{ n: number }, [string]>("SELECT COUNT(*) n FROM projects WHERE id=?").get(id)?.n) throw new NotFound(`project ${id} not found`); };

export const listAssignments = (db: Database): CommsAssignment[] => db.query<AssignmentRow, []>("SELECT * FROM comms_assignments ORDER BY created_at, id").all().map(assignment);
export const getAssignment = (db: Database, id: string): CommsAssignment => { const r = getAssignmentRow(db, id); if (!r) throw new NotFound(`Comms assignment ${id} not found`); return assignment(r); };
export const createAssignment = (db: Database, input: CommsAssignmentCreate, now: Date): CommsAssignment => {
  ensureProject(db, input.projectId); const id = randomUUID(); const at = now.toISOString();
  db.query("INSERT INTO comms_assignments (id,project_id,objective,audience,format,owner,enabled,on_change,cadence,created_at,updated_at,last_input_fingerprint) VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL)").run(id, input.projectId, input.objective, input.audience, input.format, input.owner, (input.enabled ?? true) ? 1 : 0, (input.onChange ?? false) ? 1 : 0, input.cadence ?? "manual", at, at); return getAssignment(db, id);
};
export const updateAssignment = (db: Database, id: string, input: CommsAssignmentUpdate, now: Date): CommsAssignment => {
  const current = getAssignment(db, id); if (input.expectedUpdatedAt !== current.updatedAt) throw new Conflict("Assignment changed since you opened it. Refresh before saving.");
  const at = new Date(Math.max(now.getTime(), Date.parse(current.updatedAt) + 1)).toISOString(); const merged = { ...current, ...input };
  const changed = db.query("UPDATE comms_assignments SET objective=?,audience=?,format=?,owner=?,enabled=?,on_change=?,cadence=?,updated_at=? WHERE id=? AND updated_at=?").run(merged.objective, merged.audience, merged.format, merged.owner, merged.enabled ? 1 : 0, merged.onChange ? 1 : 0, merged.cadence, at, id, input.expectedUpdatedAt).changes;
  if (!changed) throw new Conflict("Assignment changed since you opened it. Refresh before saving.");
  return getAssignment(db, id);
};
export const listRuns = (db: Database, id: string): CommsRun[] => { getAssignment(db, id); return db.query<RunRow, [string]>("SELECT * FROM comms_runs WHERE assignment_id=? ORDER BY started_at DESC, rowid DESC").all(id).map(run); };
export const listMessages = (db: Database, id: string): CommsMessage[] => { getAssignment(db, id); return db.query<MessageRow, [string]>("SELECT * FROM comms_messages WHERE assignment_id=? ORDER BY rowid").all(id).map(message); };
export const listArtifacts = (db: Database, projectId?: string): CommsArtifact[] => db.query<ArtifactRow, string[]>(projectId ? "SELECT * FROM comms_artifacts WHERE project_id=? ORDER BY created_at DESC, rowid DESC" : "SELECT * FROM comms_artifacts ORDER BY created_at DESC, rowid DESC").all(...(projectId ? [projectId] : [])).map(artifact);
export const getArtifact = (db: Database, id: string): CommsArtifact => { const r = db.query<ArtifactRow, [string]>("SELECT * FROM comms_artifacts WHERE id=?").get(id); if (!r) throw new NotFound(`Comms artifact ${id} not found`); return artifact(r); };
export const getDetail = (db: Database, id: string): CommsWorkspaceDetail => ({ assignment: getAssignment(db, id), runs: listRuns(db, id), messages: listMessages(db, id), artifacts: db.query<ArtifactRow, [string]>("SELECT * FROM comms_artifacts WHERE assignment_id=? ORDER BY version DESC").all(id).map(artifact) });
export const approveArtifact = (db: Database, id: string, status: "draft" | "approved", now: Date): CommsArtifact => { getArtifact(db, id); db.query("UPDATE comms_artifacts SET status=?,approved_at=? WHERE id=?").run(status, status === "approved" ? now.toISOString() : null, id); return getArtifact(db, id); };

const inputFingerprint = (db: Database, a: CommsAssignment, now: Date): string => {
  const state = loadState(db, now); const p = state.projects.find((x) => x.id === a.projectId); const dev = state.dev[a.projectId];
  const latestPm = db.query<{ output: string }, [string]>("SELECT output FROM pm_runs WHERE project_id=? AND state IN ('done','attention') ORDER BY finished_at DESC, rowid DESC LIMIT 1").get(a.projectId)?.output ?? null;
  return hash({ project: p, releases: state.releases[a.projectId] ?? [], dev: dev ? { ...dev, lastSync: undefined } : null, calendar: state.calendar.filter(event => event.proj === a.projectId), purpose: { objective: a.objective, audience: a.audience, format: a.format, owner: a.owner }, latestPm });
};
const previousSuccess = (db: Database, id: string): CommsRun | undefined => db.query<RunRow, [string]>("SELECT * FROM comms_runs WHERE assignment_id=? AND mode='draft' AND state IN ('done','attention') ORDER BY finished_at DESC, rowid DESC LIMIT 1").all(id).map(run)[0];
const latestPmOutput = (db: Database, projectId: string): string => db.query<{ output: string }, [string]>("SELECT output FROM pm_runs WHERE project_id=? AND state IN ('done','attention') ORDER BY finished_at DESC, rowid DESC LIMIT 1").get(projectId)?.output ?? "No successful PM assessment is available.";

export const runAssignment = async (db: Database, llm: Llm, id: string, now: Date, trigger: "manual" | "scheduled", instruction?: string, mode: "draft" | "conversation" = "draft"): Promise<CommsRun> => {
  const a = getAssignment(db, id); const fp = inputFingerprint(db, a, now); const latest = listRuns(db, id)[0];
  if (mode === "conversation" && !instruction?.trim()) throw new Conflict("Conversation mode requires an instruction");
  if (latest && (latest.state === "queued" || latest.state === "working")) throw new Conflict("Comms assignment is already running");
  if (trigger === "scheduled") {
    if (!a.enabled) throw new Conflict("Comms assignment is paused");
    if (latest?.state === "failed" && now.getTime() - Date.parse(latest.startedAt) < 3_600_000) throw new Conflict("Comms failure cooldown");
    const success = previousSuccess(db, id); const weekly = a.cadence === "weekly" && (!success || now.getTime() - Date.parse(success.startedAt) >= 7 * 86_400_000); const changed = a.onChange && a.lastInputFingerprint !== fp;
    if (!weekly && !changed) throw new Conflict("Comms inputs are not due");
  }
  const rid = randomUUID(); const at = now.toISOString();
  const history = listMessages(db, id).slice(-12).map((m) => `${m.role}: ${m.content.slice(0, 1000)}`).join("\n"); const pm = latestPmOutput(db, a.projectId).slice(0, 5000); const priorRaw = previousSuccess(db, id)?.output ?? ""; const priorDraft = priorRaw.length > 8000 ? `${priorRaw.slice(0, 8000)}\n[Earlier draft content truncated.]` : priorRaw; const userInstruction = instruction ?? "Prepare the requested communication draft.";
  const prompt = [`${mode === "draft" ? "Draft a complete communication; never send externally or mark approved." : "Answer the user's question conversationally; do not create a communication artifact."} Treat prior model output as unverified context.`, `Objective: ${a.objective}`, `Audience: ${a.audience}`, `Format: ${a.format}`, `Latest PM assessment:\n${pm}`, priorDraft ? `Latest communications draft:\n${priorDraft}` : "", history ? `Conversation history:\n${history}` : "", `Current instruction:\n${userInstruction}`].filter(Boolean).join("\n\n");
  db.transaction(() => { db.query("INSERT INTO comms_runs (id,assignment_id,project_id,trigger,mode,input_fingerprint,state,summary,output,error,started_at,finished_at) VALUES (?,?,?,?,?,?,'queued','Queued','',NULL,?,NULL)").run(rid, id, a.projectId, trigger, mode, fp, at); if (trigger === "manual") db.query("INSERT INTO comms_messages (id,assignment_id,run_id,role,content,created_at) VALUES (?,?,?,?,?,?)").run(randomUUID(), id, rid, "user", userInstruction, at); })();
  try {
    db.query("UPDATE comms_runs SET state='working',summary=? WHERE id=?").run(mode === "conversation" ? "Preparing reply" : "Preparing communication", rid);
    const commsAgent = loadState(db, now).agents.find((agent) => agent.kind === "comms"); if (!commsAgent) throw new NotFound("communications agent not found");
    const agentRun = await runAgent(db, llm, { agentId: commsAgent.id, proj: a.projectId, tab: "value", instruction: prompt }, now, { onCreated: (r) => db.query("UPDATE comms_runs SET agent_run_id=? WHERE id=?").run(r.id, rid) });
    const finishedAt = agentRun.finishedAt ?? new Date().toISOString(); const result = { ...run(db.query<RunRow, [string]>("SELECT * FROM comms_runs WHERE id=?").get(rid)!), agentRunId: agentRun.id, state: agentRun.state, summary: agentRun.summary, output: agentRun.output, error: agentRun.error, finishedAt } as CommsRun;
    if ((result.state === "done" || result.state === "attention") && !result.output.trim()) {
      result.state = "failed";
      result.summary = "No communication text returned";
      result.error = "The model returned an empty response. Try again; no artifact was created.";
    }
    db.transaction(() => {
      db.query("UPDATE comms_runs SET agent_run_id=?,state=?,summary=?,output=?,error=?,finished_at=? WHERE id=?").run(result.agentRunId, result.state, result.summary, result.output, result.error, finishedAt, rid);
      if (result.state === "done" || result.state === "attention") { db.query("INSERT INTO comms_messages (id,assignment_id,run_id,role,content,created_at) VALUES (?,?,?,?,?,?)").run(randomUUID(), id, rid, "assistant", result.output, finishedAt); if (mode === "draft") { db.query("UPDATE comms_assignments SET last_input_fingerprint=? WHERE id=?").run(fp, id); const version = (db.query<{ n: number }, [string]>("SELECT COALESCE(MAX(version),0) n FROM comms_artifacts WHERE assignment_id=?").get(id)?.n ?? 0) + 1; db.query("INSERT INTO comms_artifacts (id,assignment_id,project_id,run_id,agent_run_id,title,format,version,body,status,approved_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,'draft',NULL,?)").run(randomUUID(), id, a.projectId, rid, agentRun.id, `${a.format.replaceAll("_", " ")} — ${a.objective.slice(0, 80)}`, a.format, version, result.output, finishedAt); } }
    })(); return result;
  } catch (e) { const msg = e instanceof Error ? e.message : String(e); db.query("UPDATE comms_runs SET state='failed',summary='Comms run failed',error=?,finished_at=? WHERE id=?").run(msg, new Date().toISOString(), rid); return run(db.query<RunRow, [string]>("SELECT * FROM comms_runs WHERE id=?").get(rid)!); }
};

export const runDueComms = async (db: Database, llm: Llm, now: Date): Promise<CommsRun[]> => { const out: CommsRun[] = []; for (const a of listAssignments(db)) if (a.enabled && (a.cadence === "weekly" || a.onChange)) { try { out.push(await runAssignment(db, llm, a.id, now, "scheduled")); } catch (e) { if (!(e instanceof Conflict)) console.error(`Comms assignment ${a.id} failed`, e); } } return out; };
