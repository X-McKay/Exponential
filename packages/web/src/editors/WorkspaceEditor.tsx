import { LlmSettings } from "../ui/LlmSettings.tsx";
import { SessionSelector } from "../ui/SessionSelector.tsx";
import { request } from "../api/client.ts";
import type { WorkspaceMember } from "@valueflow/domain";
import { selectSession, sessionRole } from "../api/session.ts";
import { useState } from "react";
import type { Workspace } from "@valueflow/domain";
import { Btn, Lbl, Modal, inpStyle } from "../ui/primitives.tsx";
import { C } from "../theme.ts";

/** Who is signed in: shown in the sidebar and greeted on Glance. */
export function WorkspaceEditor({ workspace, onSave, onClose }: { workspace: Workspace; onSave: (w: Workspace) => Promise<unknown>; onClose: () => void }) {
  const role = sessionRole();
  const [memberName, setMemberName] = useState("");
  const [name, setName] = useState(workspace.user.name);
  const ini = workspace.user.ini;
  const valid = name.trim() !== "" && ini.trim() !== "";
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const submit = async () => {
    if (!valid || saving || role === "viewer") return;
    setSaving(true); setSaveError(null);
    try { await onSave({ ...workspace, user: { name: name.trim(), ini: ini.trim().toUpperCase() } }); }
    catch (e) { setSaveError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  };
  return (
    <Modal
      title="Workspace"
      onClose={onClose}
      onSubmit={() => void submit()}
      footer={
        <>
          <Btn onClick={onClose}>Close</Btn>
          <Btn tone="primary" disabled={!valid || saving || role === "viewer"} onClick={() => void submit()}>
            {saving ? "Saving…" : "Save profile"}
          </Btn>
        </>
      }
    >
      {saveError && <div role="alert" style={{ color: C.redHi, fontSize: 12, margin: "8px 0" }}>Could not save: {saveError}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 90px", gap: 10 }}>
        <div>
          <Lbl>Your name</Lbl>
          <input
            style={inpStyle}
            value={name}
            disabled={role === "viewer"}
            aria-label="Your name"
            autoFocus
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </div>
        <div>
          <Lbl>Initials</Lbl>
          <input aria-label="Initials" readOnly style={inpStyle} value={ini} maxLength={3} />
        </div>
      </div>
      <div style={{ fontSize: 12, color: C.dim, marginTop: 10 }}>Profile changes affect the selected user. Existing member initials are retained as a stable attribution key.</div>
      <details style={{ marginTop: 16 }}><summary>Switch user or role</summary><SessionSelector /></details>
      {role === "admin" ? <><section style={{ marginTop: 16 }}>
        <Lbl>Add a workspace user</Lbl>
        <input aria-label="New user name" style={inpStyle} value={memberName} onChange={e => setMemberName(e.target.value)} placeholder="Full name" />
        <Btn disabled={saving || !memberName.trim()} onClick={() => { setSaving(true); setSaveError(null); void request<WorkspaceMember>("POST", "/api/members", { name: memberName.trim(), role: "editor" }).then(m => selectSession(m.id, m.role)).catch(e => setSaveError(e.message)).finally(() => setSaving(false)); }}>Add user</Btn>
      </section>
      <LlmSettings /></> : <p style={{ color: C.dim }}>Switch to Administrator to manage users and the LLM connection.</p>}
    </Modal>
  );
}
