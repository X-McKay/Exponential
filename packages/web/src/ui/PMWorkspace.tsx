import { useCallback, useEffect, useRef, useState } from "react";
import type { Agent, AgentRun, LlmInfo, Project } from "@valueflow/domain";
import type { PMAssignment, PMAssignmentUpdate, PMCommitmentStatus, PMRun } from "@valueflow/shared";
import { CommsWorkspace } from "./CommsWorkspace.tsx";
import { pmApi } from "../api/pmClient.ts";
import { api } from "../api/client.ts";
import { Btn, Chip, SectionCard, ghostBtn, inpStyle, reset } from "./primitives.tsx";
import { AgentDraftPlaceholder, AgentRunIndicator } from "./AgentRunIndicator.tsx";
import { Markdown } from "../editors/RunAgent.tsx";
import { C } from "../theme.ts";
import "./PMWorkspace.css";

export interface PMWorkspaceProps {
  projects: Project[]; agents: Agent[]; llm: LlmInfo | null; asOf: string; userIni: string;
  onInspectRun: (run: AgentRun) => void;
  onRefresh: () => Promise<void>;
}
const active = (r: { state: string }) => r.state === "working" || r.state === "queued";
const message = (e: unknown) => e instanceof Error ? e.message : "Request failed. Please try again.";

export function PMWorkspace({ projects, agents, llm, userIni, onInspectRun, onRefresh }: PMWorkspaceProps) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [role, setRole] = useState<"pm" | "comms">("pm");
  const [assignments, setAssignments] = useState<PMAssignment[]>([]);
  const [assignmentId, setAssignmentId] = useState("");
  const [history, setHistory] = useState<PMRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [objective, setObjective] = useState("");
  const [owner, setOwner] = useState(userIni);
  const [instruction, setInstruction] = useState("");
  const [commitment, setCommitment] = useState("");
  const [commitOwner, setCommitOwner] = useState(userIni);
  const [due, setDue] = useState("");
  const requestLock = useRef(false);
  const currentSelection = useRef(assignmentId);
  useEffect(() => { currentSelection.current = assignmentId; }, [assignmentId]);
  const scoped = assignments.filter(a => a.projectId === projectId);
  const assignment = scoped.find(a => a.id === assignmentId);
  const pm = agents.find(a => a.id === "project-manager");
  const historyForSelection = history.filter(r => r.assignmentId === assignmentId);
  const latest = historyForSelection[0];
  const running = historyForSelection.some(active) || starting === assignmentId;

  const load = useCallback(async () => {
    const data = await pmApi.assignments<PMAssignment[]>();
    setAssignments(data);
    return data;
  }, []);
  useEffect(() => { void load().catch(e => setError(message(e))).finally(() => setLoading(false)); }, [load]);
  useEffect(() => {
    if (!scoped.some(a => a.id === assignmentId)) setAssignmentId(scoped[0]?.id ?? "");
  }, [assignments, projectId, assignmentId]);
  useEffect(() => {
    if (!assignmentId) { setHistory([]); return; }
    let cancelled = false;
    let pending = false;
    const poll = async () => {
      if (pending) return;
      pending = true;
      try {
        const data = await pmApi.runs<PMRun[]>(assignmentId);
        if (!cancelled) setHistory(data);
      } catch (e) { if (!cancelled) setError(message(e)); }
      finally { pending = false; }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [assignmentId]);

  const mutate = async (fn: () => Promise<void>) => {
    if (requestLock.current) return;
    requestLock.current = true;
    setBusy(true); setError(null);
    try { await fn(); await load(); }
    catch (e) { setError(message(e)); }
    finally { setBusy(false); requestLock.current = false; }
  };
  const update = (patch: PMAssignmentUpdate) => {
    if (!assignment) return;
    void mutate(async () => { await pmApi.updateAssignment(assignment.id, { ...patch, expectedUpdatedAt: assignment.updatedAt }); });
  };
  const review = async () => {
    if (!assignment || !llm || running || requestLock.current) return;
    const id = assignment.id;
    const text = instruction.trim();
    requestLock.current = true; setStarting(id); setError(null);
    try {
      const result = await pmApi.run<PMRun>(id, { instruction: text || undefined });
      if (currentSelection.current === id) {
        const completedHistory = await pmApi.runs<PMRun[]>(id);
        if (currentSelection.current !== id) return;
        setHistory(completedHistory);
        if (result.state === "failed") setError(result.error ?? "Review failed; inspect the run for details.");
        else setInstruction("");
      }
      await onRefresh();
    } catch (e) { setError(message(e)); }
    finally { requestLock.current = false; setStarting(null); }
  };
  const inspect = async (r: PMRun) => {
    if (!r.agentRunId) return;
    setError(null);
    try {
      // Agent history includes older runs that are outside the dashboard window.
      const found = await api.getRun(r.agentRunId);
      if (!found) throw new Error("The detailed run is no longer available.");
      onInspectRun(found);
      void onRefresh();
    } catch (e) { setError(message(e)); }
  };
  if (loading) return <div role="status" style={{ padding: 16, color: C.dim }}>Loading AI team…</div>;
  return <div className="vf-pm-workspace">
    {error && <div role="alert" className="vf-pm-error">{error} <button style={ghostBtn} onClick={() => void mutate(async () => {})}>Refresh</button></div>}
    <SectionCard title="AI team" right={<select aria-label="Agent project" style={{ ...inpStyle, width: "min(300px, 100%)" }} value={projectId} onChange={e => { setProjectId(e.target.value); setInstruction(""); }}>
      {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>}>
      <div className="vf-pm-roles">
        <button aria-pressed={role === "pm"} style={{ ...reset, color: role === "pm" ? C.text : C.dim }} onClick={() => { setRole("pm"); setInstruction(""); }}>Project Manager</button>
        <button aria-pressed={role === "comms"} style={{ ...reset, color: role === "comms" ? C.text : C.dim }} onClick={() => { setRole("comms"); setInstruction(""); }}>Communications Director</button>
        <span style={{ marginLeft: "auto", fontSize: 11, color: llm ? C.dim : C.amber }}>{llm ? "Model connected" : "Connect a model to run agents"}</span>
      </div>
      {role === "pm" ? <>
        <p className="vf-pm-description">Review project health, resolve blockers, and follow through on agreed commitments.</p>
        {!!scoped.length && <label className="vf-pm-field">Assignment<select style={inpStyle} value={assignmentId} onChange={e => { setAssignmentId(e.target.value); setInstruction(""); }}>
          {scoped.map(a => <option key={a.id} value={a.id}>{a.objective}</option>)}
        </select></label>}
        <details open={!scoped.length} className="vf-pm-new">
          <summary>{scoped.length ? "New assignment" : "Give your Project Manager an assignment"}</summary>
          <form className="vf-pm-form" onSubmit={e => { e.preventDefault(); void mutate(async () => {
            const saved = await pmApi.createAssignment<PMAssignment>({ projectId, objective: objective.trim(), owner: owner.trim(), enabled: true, onChange: false, cadence: "manual", commitments: [] });
            setAssignments(old => [...old, saved]); setAssignmentId(saved.id); setObjective("");
          }); }}>
            <label className="vf-pm-field vf-pm-wide">Objective<textarea required maxLength={2000} style={inpStyle} value={objective} onChange={e => setObjective(e.target.value)} placeholder="Assess release readiness and identify the decisions we need to make." /></label>
            <label className="vf-pm-field">Accountable owner<input required maxLength={80} style={inpStyle} value={owner} onChange={e => setOwner(e.target.value)} /></label>
            <button type="submit" className="vf-ghost" style={ghostBtn} disabled={busy || !!starting || !projectId || !objective.trim() || !owner.trim()}>Create assignment</button>
          </form>
        </details>
        {assignment && <>
          <div className="vf-pm-heading"><div><strong>{assignment.objective}</strong><div className="vf-pm-meta">Owner {assignment.owner} · {assignment.enabled && (assignment.onChange || assignment.cadence === "weekly") ? "Background checks enabled" : "On demand"}</div></div>
            {running && <AgentRunIndicator running size={32} label="Project Manager running" />}
          </div>
          <label className="vf-pm-field">Message your Project Manager<textarea maxLength={4000} style={inpStyle} value={instruction} onChange={e => setInstruction(e.target.value)} placeholder="Optional: focus this review or ask a follow-up question…" /></label>
          <div className="vf-pm-actions"><Btn tone="primary" disabled={!llm || !pm || running || busy || !!starting} onClick={() => void review()}>{running ? "Review in progress" : instruction.trim() ? "Send follow-up" : "Review project"}</Btn><span className="vf-pm-meta">Uses current facts and the last successful assessment.</span></div>
          {running && <AgentDraftPlaceholder />}
          <details className="vf-pm-new"><summary>Background checks</summary><div className="vf-pm-settings">
            <label><input type="checkbox" disabled={busy || !!starting} checked={assignment.enabled} onChange={e => update({ enabled: e.target.checked })} /> Allow background checks</label>
            <label><input type="checkbox" disabled={busy || !!starting} checked={assignment.onChange} onChange={e => update({ onChange: e.target.checked })} /> When project facts change</label>
            <label><input type="checkbox" disabled={busy || !!starting} checked={assignment.cadence === "weekly"} onChange={e => update({ cadence: e.target.checked ? "weekly" : "manual" })} /> Weekly review</label>
          </div><p className="vf-pm-meta">Requires the server scheduler. Pausing prevents future background runs; it does not stop a review already in progress.</p></details>
          <details className="vf-pm-new"><summary>Agreed commitments · {assignment.commitments.length}</summary>
            <p className="vf-pm-meta">Record decisions you have agreed to. Only you change their status.</p>
            {assignment.commitments.map(c => <div className="vf-pm-commitment" key={c.id}><div><strong>{c.title}</strong><div className="vf-pm-meta">{c.owner} · {c.due ?? "No due date"}</div></div><select aria-label={`Status for ${c.title}`} disabled={busy || !!starting} style={{ ...inpStyle, width: 140 }} value={c.status} onChange={e => update({ commitments: assignment.commitments.map(x => x.id === c.id ? { ...x, status: e.target.value as PMCommitmentStatus } : x) })}>
              <option value="open">Open</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="done">Done</option>
            </select></div>)}
            <form className="vf-pm-form" onSubmit={e => { e.preventDefault(); void mutate(async () => {
              await pmApi.updateAssignment(assignment.id, { expectedUpdatedAt: assignment.updatedAt, commitments: [...assignment.commitments, { title: commitment.trim(), owner: commitOwner.trim(), due: due || null, status: "open" }] });
              setCommitment(""); setDue("");
            }); }}>
              <label className="vf-pm-field vf-pm-wide">Commitment<input required maxLength={240} style={inpStyle} value={commitment} onChange={e => setCommitment(e.target.value)} /></label>
              <label className="vf-pm-field">Owner<input required maxLength={80} style={inpStyle} value={commitOwner} onChange={e => setCommitOwner(e.target.value)} /></label>
              <label className="vf-pm-field">Due date (optional)<input type="date" style={inpStyle} value={due} onChange={e => setDue(e.target.value)} /></label>
              <button type="submit" className="vf-ghost" style={ghostBtn} disabled={busy || !!starting || !commitment.trim() || !commitOwner.trim()}>Add commitment</button>
            </form>
          </details>
        </>}
      </> : <CommsWorkspace key={projectId} projectId={projectId} projects={projects} llm={llm} userIni={userIni} onInspectRun={onInspectRun} onRefresh={onRefresh} />}
    </SectionCard>
    {role === "pm" && assignment && <SectionCard title="Activity & results" right={<Chip>{historyForSelection.length} runs</Chip>}>
      {latest && !active(latest) && latest.output && <div className="vf-pm-assessment"><Markdown text={latest.output} /></div>}
      {historyForSelection.length ? historyForSelection.map(r => <div className="vf-pm-run" key={r.id}><div><strong>{r.summary}</strong><div className="vf-pm-meta">{new Date(r.startedAt).toLocaleString()} · {r.trigger} · {r.state}</div>{r.error && <div role="status" style={{ color: C.redHi }}>{r.error}</div>}</div><button style={ghostBtn} disabled={!r.agentRunId} onClick={() => void inspect(r)}>Steps & logs ↗</button></div>) : <p className="vf-pm-meta">No reviews yet. Start a review to see the assessment, steps, and logs here.</p>}
    </SectionCard>}

  </div>;
}
