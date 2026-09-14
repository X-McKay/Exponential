import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentRun, LlmInfo, Project } from "@valueflow/domain";
import type { CommsArtifact, CommsAssignment, CommsAssignmentUpdate, CommsRun, CommsFormat } from "@valueflow/shared";
import { api } from "../api/client.ts";
import { commsApi } from "../api/commsClient.ts";
import { AgentDraftPlaceholder, AgentRunIndicator } from "./AgentRunIndicator.tsx";
import { ghostBtn, inpStyle, reset } from "./primitives.tsx";
import { Markdown } from "../editors/RunAgent.tsx";
import { C } from "../theme.ts";
import "./CommsWorkspace.css";

export interface CommsWorkspaceProps {
  projectId: string; projects: Project[]; llm: LlmInfo | null; userIni: string;
  onInspectRun: (run: AgentRun) => void; onRefresh: () => Promise<void>;
}
type Tab = "conversation" | "activity" | "assets";
type Update = Omit<CommsAssignmentUpdate, "expectedUpdatedAt">;
const formats: CommsFormat[] = ["executive_update", "release_notes", "decision_memo", "project_brief"];
const isFormat = (value: string): value is CommsFormat => formats.some(formatName => formatName === value);
const active = (run: CommsRun) => run.state === "working" || run.state === "queued";
const errMessage = (e: unknown) => e instanceof Error ? e.message : "Request failed. Please try again.";

export function CommsWorkspace({ projectId, projects, llm, userIni, onInspectRun, onRefresh }: CommsWorkspaceProps) {
  const [assignments, setAssignments] = useState<CommsAssignment[]>([]);
  const [assignmentId, setAssignmentId] = useState("");
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof commsApi.detail>> | null>(null);
  const [artifacts, setArtifacts] = useState<CommsArtifact[]>([]);
  const [tab, setTab] = useState<Tab>("conversation");
  const [objective, setObjective] = useState("");
  const [audience, setAudience] = useState("");
  const [format, setFormat] = useState<CommsAssignment["format"]>("executive_update");
  const [owner, setOwner] = useState(userIni);
  const [editObjective, setEditObjective] = useState("");
  const [editAudience, setEditAudience] = useState("");
  const [editOwner, setEditOwner] = useState("");
  const [editFormat, setEditFormat] = useState<CommsFormat>("executive_update");
  const [instruction, setInstruction] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);
  const [startingMode, setStartingMode] = useState<"draft" | "conversation">("draft");
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const version = useRef(0);
  const selection = useRef(assignmentId);
  const scoped = assignments.filter(a => a.projectId === projectId);
  const assignment = scoped.find(a => a.id === assignmentId) ?? null;
  const currentDetail = detail?.assignment.id === assignmentId ? detail : null;
  const runs = currentDetail?.runs ?? [];
  const running = runs.some(active) || starting === assignmentId;
  const runningMode = runs.find(active)?.mode ?? startingMode;
  const projectName = projects.find(p => p.id === projectId)?.name ?? "this project";

  const load = useCallback(async () => {
    const token = ++version.current;
    const [all, assets] = await Promise.all([commsApi.assignments(), commsApi.artifacts(projectId)]);
    if (token !== version.current) return;
    setAssignments(all); setArtifacts(assets);
  }, [projectId]);
  useEffect(() => { setDetail(null); setAssignmentId(""); setLoading(true); setError(null); void load().catch(e => setError(errMessage(e))).finally(() => setLoading(false)); }, [load]);
  useEffect(() => { selection.current = assignmentId; }, [assignmentId]);
  useEffect(() => { if (!scoped.some(a => a.id === assignmentId)) { setAssignmentId(scoped[0]?.id ?? ""); setInstruction(""); } }, [assignments, projectId, assignmentId]);
  useEffect(() => { if (assignment) { setEditObjective(assignment.objective); setEditAudience(assignment.audience); setEditOwner(assignment.owner); setEditFormat(assignment.format); } }, [assignment?.id, assignment?.updatedAt]);
  useEffect(() => {
    if (!assignmentId) { setDetail(null); return; }
    let cancelled = false; let pending = false;
    const poll = async () => { if (pending) return; pending = true; try { const [d, assets] = await Promise.all([commsApi.detail(assignmentId), commsApi.artifacts(projectId)]); if (!cancelled) { setDetail(d); setArtifacts(assets); } } catch (e) { if (!cancelled) setError(errMessage(e)); } finally { pending = false; } };
    void poll(); const timer = window.setInterval(() => void poll(), 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [assignmentId, projectId]);
  const mutate = async (fn: () => Promise<void>) => { if (lock.current) return; lock.current = true; setBusy(true); setError(null); try { await fn(); await load(); } catch (e) { setError(errMessage(e)); } finally { lock.current = false; setBusy(false); } };
  const update = (patch: Update) => {
    if (!assignment) return;
    const before = assignment;
    void mutate(async () => { await commsApi.updateAssignment(before.id, { ...patch, expectedUpdatedAt: before.updatedAt }); });
  };
  const run = async (mode: "draft" | "conversation") => {
    if (!assignment || !llm || running || lock.current) return;
    lock.current = true; setBusy(true); setStarting(assignment.id); setStartingMode(mode); setError(null);
    try { const selectedId = assignment.id; const text = instruction.trim(); const result = await commsApi.run(selectedId, text || undefined, mode); const d = await commsApi.detail(selectedId); const assets = await commsApi.artifacts(projectId); if (selection.current === selectedId) { setDetail(d); setArtifacts(assets); } if (result.state === "failed") setError(result.error ?? (mode === "conversation" ? "Reply failed; inspect the run for details." : "Draft failed; inspect the run for details.")); else if (selection.current === selectedId) setInstruction(""); await onRefresh(); }
    catch (e) { setError(errMessage(e)); } finally { lock.current = false; setBusy(false); setStarting(null); }
  };
  const inspect = async (runItem: CommsRun) => { if (!runItem.agentRunId) return; try { const found = await api.getRun(runItem.agentRunId); onInspectRun(found); } catch (e) { setError(errMessage(e)); } };
  if (loading) return <div role="status" style={{ padding: 16, color: C.dim }}>Loading Communications Director…</div>;
  return <div className="vf-comms">
    {error && <div role="alert" className="vf-pm-error">{error} <button type="button" style={ghostBtn} onClick={() => void mutate(async () => {})}>Refresh</button></div>}
    {!llm && <div role="status" className="vf-pm-error" style={{ color: C.amber }}>Connect a model to draft communications.</div>}
    <div className="vf-comms-content">
      <div className="vf-comms-grid">
        <div className="vf-comms-list">
          {scoped.map(a => <button type="button" className="vf-comms-assignment" aria-current={a.id === assignmentId} key={a.id} onClick={() => { setAssignmentId(a.id); setInstruction(""); setTab("conversation"); }}>{a.objective}<div className="vf-pm-meta">{a.format.replaceAll("_", " ")} · {a.enabled ? (a.cadence === "weekly" ? (a.onChange ? "Weekly + on change" : "Weekly") : a.onChange ? "On change" : "On demand") : "Background paused"}</div></button>)}
          <details open={!scoped.length} className="vf-pm-new"><summary>New communication brief</summary><form className="vf-comms-form" onSubmit={e => { e.preventDefault(); void mutate(async () => { const saved = await commsApi.createAssignment({ projectId, objective: objective.trim(), audience: audience.trim(), format, owner: owner.trim(), enabled: true, onChange: false, cadence: "manual" }); setAssignments(old => [...old, saved]); setAssignmentId(saved.id); setObjective(""); setAudience(""); }); }}>
            <label>Objective<textarea required maxLength={2000} style={inpStyle} value={objective} onChange={e => setObjective(e.target.value)} placeholder="Keep leadership aligned on the next release." /></label>
            <label>Audience<input required maxLength={240} style={inpStyle} value={audience} onChange={e => setAudience(e.target.value)} placeholder="Executive team" /></label>
            <label>Format<select style={inpStyle} value={format} onChange={e => { if (isFormat(e.target.value)) setFormat(e.target.value); }}><option value="executive_update">Executive update</option><option value="release_notes">Release notes</option><option value="decision_memo">Decision memo</option><option value="project_brief">Project brief</option></select></label>
            <label>Owner<input required maxLength={80} style={inpStyle} value={owner} onChange={e => setOwner(e.target.value)} /></label>
            <button type="submit" className="vf-ghost" style={ghostBtn} disabled={busy || !objective.trim() || !audience.trim() || !owner.trim()}>Create brief</button>
          </form></details>
        </div>
        <div>
          {!assignment && <p className="vf-pm-meta">Create a brief to start a durable communications workspace.</p>}
          {assignment && <>
            <div className="vf-comms-tabs" role="tablist" aria-label="Communications workspace">{(["conversation", "activity", "assets"] as const).map(t => <button type="button" key={t} role="tab" aria-selected={tab === t} style={{ ...reset, color: tab === t ? C.text : C.dim }} onClick={() => setTab(t)}>{t.slice(0, 1).toUpperCase() + t.slice(1)}</button>)}</div>
            {tab === "conversation" && <><div className="vf-comms-conversation">{currentDetail?.messages.length ? currentDetail.messages.map(m => <div className="vf-comms-message" key={m.id}><div className="vf-pm-meta">{m.role === "user" ? "You" : "Communications Director"} · {new Date(m.createdAt).toLocaleString()}</div><div className="vf-comms-message-body">{m.role === "assistant" ? <Markdown text={m.content} /> : m.content}</div></div>) : <p className="vf-pm-meta">Ask a question to shape the communication, or create a draft from this brief.</p>}</div><form className="vf-comms-composer" onSubmit={e => { e.preventDefault(); void run("draft"); }}><textarea aria-label="Message your Communications Director" disabled={busy || running} maxLength={4000} style={inpStyle} value={instruction} onChange={e => setInstruction(e.target.value)} placeholder="Ask a question or describe the communication to draft…" /><div className="vf-pm-actions"><button type="button" className="vf-comms-submit vf-comms-secondary" disabled={!llm || busy || running || !instruction.trim()} onClick={() => void run("conversation")}>Send message</button><button type="submit" className="vf-comms-submit" disabled={!llm || busy || running}>{running ? "Working…" : "Create draft"}</button>{running && <AgentRunIndicator running size={30} label="Communications Director running" />}</div></form>{running && <AgentDraftPlaceholder label={runningMode === "conversation" ? "Preparing reply" : "Preparing communication"} />}</>}
            {tab === "activity" && <>{runs.length ? runs.map(r => <div className="vf-comms-run" key={r.id}><div><strong>{r.summary}</strong><div className="vf-pm-meta">{new Date(r.startedAt).toLocaleString()} · {r.trigger} · {r.mode} · {r.state}</div>{r.error && <div style={{ color: C.redHi }}>{r.error}</div>}</div>{active(r) && <AgentRunIndicator running size={24} label="Communication run active" />}<button type="button" style={ghostBtn} disabled={!r.agentRunId} onClick={() => void inspect(r)}>Steps & logs ↗</button></div>) : <p className="vf-pm-meta">No runs yet.</p>}</>}
            {tab === "assets" && <><p className="vf-pm-meta">{projectName} · drafts and approved versions. Approval marks this version reviewed; nothing is sent.</p>{artifacts.length ? artifacts.map(a => <div className="vf-comms-artifact" key={a.id}><div><strong>{a.title}</strong><div className="vf-pm-meta">v{a.version} · {a.status} · {new Date(a.createdAt).toLocaleString()}</div><details><summary style={{ cursor: "pointer", marginTop: 10 }}>Preview version {a.version}</summary><div className="vf-comms-preview"><Markdown text={a.body} /></div></details></div><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><button type="button" style={ghostBtn} onClick={() => { void api.getRun(a.agentRunId).then(onInspectRun).catch(e => setError(errMessage(e))); }}>View run</button><a style={ghostBtn} href={commsApi.downloadUrl(a.id, "md")} download>Markdown</a><a style={ghostBtn} href={commsApi.downloadUrl(a.id, "txt")} download>Text</a>{a.status === "draft" && <button type="button" style={ghostBtn} disabled={busy} onClick={() => void mutate(async () => { await commsApi.updateArtifact(a.id, "approved"); })}>Approve</button>}</div></div>) : <p className="vf-pm-meta">Approved and draft assets for this project will appear here.</p>}</>}
            <details className="vf-pm-new"><summary>Settings</summary><form className="vf-comms-form" onSubmit={e => { e.preventDefault(); update({ objective: editObjective.trim(), audience: editAudience.trim(), owner: editOwner.trim(), format: editFormat }); }}><label>Objective<textarea required maxLength={2000} style={inpStyle} value={editObjective} onChange={e => setEditObjective(e.target.value)} /></label><label>Audience<input required maxLength={500} style={inpStyle} value={editAudience} onChange={e => setEditAudience(e.target.value)} /></label><label>Format<select style={inpStyle} value={editFormat} onChange={e => { if (isFormat(e.target.value)) setEditFormat(e.target.value); }}><option value="executive_update">Executive update</option><option value="release_notes">Release notes</option><option value="decision_memo">Decision memo</option><option value="project_brief">Project brief</option></select></label><label>Owner<input required maxLength={80} style={inpStyle} value={editOwner} onChange={e => setEditOwner(e.target.value)} /></label><button type="submit" className="vf-ghost" style={ghostBtn} disabled={busy || !editObjective.trim() || !editAudience.trim() || !editOwner.trim()}>Save details</button></form><div className="vf-pm-settings"><label><input type="checkbox" checked={assignment.enabled} disabled={busy} onChange={e => update({ enabled: e.target.checked })} /> Allow background drafts</label><label><input type="checkbox" checked={assignment.onChange} disabled={busy} onChange={e => update({ onChange: e.target.checked })} /> When project facts change</label><label><input type="checkbox" checked={assignment.cadence === "weekly"} disabled={busy} onChange={e => update({ cadence: e.target.checked ? "weekly" : "manual" })} /> Weekly</label></div><p className="vf-pm-meta">Requires the server scheduler. Pausing prevents future background drafts and keeps existing versions; it does not cancel active work.</p></details>
          </>}
        </div>
      </div>
    </div>
  </div>;
}
