import { useState } from "react";
import { initialsOf } from "@valueflow/domain";
import type { Workspace } from "@valueflow/domain";
import { Btn, Lbl, Modal, inpStyle } from "../ui/primitives.tsx";
import { C } from "../theme.ts";

/** Who is signed in: shown in the sidebar and greeted on Glance. */
export function WorkspaceEditor({ workspace, onSave, onClose }: { workspace: Workspace; onSave: (w: Workspace) => Promise<unknown>; onClose: () => void }) {
  const [name, setName] = useState(workspace.user.name);
  const [ini, setIni] = useState(workspace.user.ini);
  const valid = name.trim() !== "" && ini.trim() !== "";
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const submit = async () => {
    if (!valid || saving) return;
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
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn tone="primary" disabled={!valid || saving} onClick={() => void submit()}>
            {saving ? "Saving…" : "Save"}
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
            autoFocus
            onChange={(e) => {
              setName(e.target.value);
              if (ini === "" || ini === initialsOf(name)) setIni(initialsOf(e.target.value));
            }}
          />
        </div>
        <div>
          <Lbl>Initials</Lbl>
          <input style={inpStyle} value={ini} maxLength={3} onChange={(e) => setIni(e.target.value.toUpperCase())} />
        </div>
      </div>
      <div style={{ fontSize: 12, color: C.dim, marginTop: 10 }}>The first name is used in the Glance greeting; initials appear in the sidebar and as the default owner for new items.</div>
    </Modal>
  );
}
