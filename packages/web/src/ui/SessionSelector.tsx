import { useEffect, useState } from "react";
import type { WorkspaceMember, WorkspaceRole } from "@valueflow/domain";
import { request } from "../api/client.ts";
import { selectSession } from "../api/session.ts";
import { inpStyle, ghostBtn } from "./primitives.tsx";
import { C } from "../theme.ts";

export function SessionSelector({ onSettings }: { onSettings?: () => void }) {
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [actor, setActor] = useState<WorkspaceMember | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { let closed = false; const refresh = () => { void request<{ members: WorkspaceMember[]; actor: WorkspaceMember | null }>("GET", "/api/members")
    .then(data => { if (!closed) { setMembers(data.members); setActor(data.actor); setError(""); } }).catch(e => { if (!closed) setError(String(e)); }); };
    refresh(); window.addEventListener("valueflow:changed", refresh);
    return () => { closed = true; window.removeEventListener("valueflow:changed", refresh); };
  }, []);
  return <div style={{ borderTop: `1px solid ${C.line}`, padding: "10px 6px", display: "grid", gap: 7 }}>
    <label style={{ fontSize: 11, color: C.mut }}>Acting as
      <select aria-label="Workspace user" title="Switching user reloads this tab. Save unfinished edits first." style={{ ...inpStyle, width: "100%", marginTop: 4 }} value={actor?.id ?? ""} onChange={e => {
        const member = members.find(m => m.id === e.target.value); if (member) selectSession(member.id, member.role);
      }}><option value="" disabled>Select user</option>{members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
    </label>
    <select aria-label="Workspace role" style={inpStyle} value={actor?.role ?? "admin"} disabled={!actor} onChange={e => actor && selectSession(actor.id, e.target.value as WorkspaceRole)}>
      <option value="admin">Administrator</option><option value="editor">Editor</option><option value="viewer">Viewer (read-only)</option>
    </select>
    <span style={{ fontSize: 10, color: C.dim }} title="Anyone with access can select any user or role. These selections are not authentication.">Shared workspace · authentication deferred</span>
    {onSettings && <button style={ghostBtn} onClick={onSettings}>Workspace settings</button>}
    {error && <span role="alert" style={{ fontSize: 11, color: C.redHi }}>{error}</span>}
  </div>;
}
