import { useState } from "react";
import { addMonths, monthLabel, nextReleaseId, planningMonths } from "@valueflow/domain";
import type { Calendar, Criterion, Project, Release } from "@valueflow/domain";
import { Btn, Lbl, Modal, Tip, ghostBtn, inpStyle } from "../ui/primitives.tsx";
import { C } from "../theme.ts";

type CritType = Criterion["type"];

const blank = (releases: Release[], cal: Calendar): Release => ({
  id: nextReleaseId(releases),
  name: "",
  month: addMonths(cal.todayYm, 2),
  milestoneIds: [],
  criteria: [],
});

/** Default label for a criterion from what it points at. */
const autoLabel = (c: Criterion, p: Project): string => {
  switch (c.type) {
    case "gate": {
      const m = p.milestones.find((x) => x.id === c.ms);
      return m ? `${m.name} base gate (${m.metrics.map((x) => `${x.label.toLowerCase()} ≥${x.base}`).join(", ")})` : "";
    }
    case "gov": {
      const g = p.governance.find((x) => x.id === c.gid);
      return g ? `${g.name} approved` : "";
    }
    case "manual":
      return "";
  }
};

const retype = (c: Criterion, type: CritType, p: Project): Criterion => {
  const label = c.label;
  switch (type) {
    case "gate": {
      const ms = p.milestones[0]?.id ?? "";
      const next: Criterion = { type: "gate", ms, label };
      return { ...next, label: label || autoLabel(next, p) };
    }
    case "gov": {
      const gid = p.governance[0]?.id ?? "";
      const next: Criterion = { type: "gov", gid, label };
      return { ...next, label: label || autoLabel(next, p) };
    }
    case "manual":
      return { type: "manual", ok: false, label };
  }
};

/** Create or edit a release: its target month, the milestones it ships, and its go-live criteria. */
export function ReleaseEditor({
  project,
  releases,
  release,
  cal,
  onSave,
  onDelete,
  onClose,
}: {
  project: Project;
  releases: Release[];
  release: Release | null;
  cal: Calendar;
  onSave: (rel: Release, isNew: boolean) => Promise<unknown>;
  onDelete?: (rid: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const isNew = release === null;
  const [d, setD] = useState<Release>(() => (release ? structuredClone(release) : blank(releases, cal)));
  const months = planningMonths(cal);
  const [confirmDel, setConfirmDel] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const set = (patch: Partial<Release>) => setD((x) => ({ ...x, ...patch }));
  const setCrit = (i: number, c: Criterion) => setD((x) => ({ ...x, criteria: x.criteria.map((y, yi) => (yi === i ? c : y)) }));
  const toggleMs = (mid: string) => setD((x) => ({ ...x, milestoneIds: x.milestoneIds.includes(mid) ? x.milestoneIds.filter((m) => m !== mid) : [...x.milestoneIds, mid] }));

  const valid = d.name.trim() !== "" && d.criteria.every((c) => c.label.trim() !== "" && (c.type === "gate" ? c.ms !== "" : c.type === "gov" ? c.gid !== "" : true));
  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true); setSaveError(null);
    try { await onSave({ ...d, name: d.name.trim(), criteria: d.criteria.map((c) => ({ ...c, label: c.label.trim() })) }, isNew); }
    catch (e) { setSaveError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  };
  const remove = async () => {
    if (!onDelete || saving) return;
    setSaving(true); setSaveError(null);
    try { await onDelete(d.id); } catch (e) { setSaveError(e instanceof Error ? e.message : String(e)); setSaving(false); }
  };

  const addCriterion = () => {
    const next = retype({ type: "manual", ok: false, label: "" }, project.milestones.length ? "gate" : "manual", project);
    setD((x) => ({ ...x, criteria: [...x.criteria, next] }));
  };

  return (
    <Modal
      title={isNew ? "New release" : `Edit ${d.id}`}
      onClose={onClose}
      onSubmit={() => void submit()}
      footer={
        <>
          {!isNew && onDelete && (
            <span style={{ marginRight: "auto" }}>
              <Btn tone="danger" disabled={saving} onClick={() => (confirmDel ? void remove() : setConfirmDel(true))}>
                {confirmDel ? "Confirm delete" : "Delete"}
              </Btn>
            </span>
          )}
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn tone="primary" disabled={!valid || saving} onClick={() => void submit()}>
            {saving ? "Saving…" : isNew ? "Create release" : "Save changes"}
          </Btn>
        </>
      }
    >
      {saveError && <div role="alert" style={{ color: C.redHi, fontSize: 12, margin: "8px 0" }}>Could not save: {saveError}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 140px", gap: 10 }}>
        <div>
          <Lbl>Name</Lbl>
          <input style={inpStyle} value={d.name} autoFocus={isNew} placeholder="e.g. Assisted review pilot" onChange={(e) => set({ name: e.target.value })} />
        </div>
        <div>
          <Lbl>Target month</Lbl>
          <select style={inpStyle} value={d.month} onChange={(e) => set({ month: e.target.value })}>
            {!months.includes(d.month) && <option value={d.month}>{d.month}</option>}
            {months.map((mo) => (
              <option key={mo} value={mo}>
                {monthLabel(mo, cal.todayYm)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <Lbl>Milestones shipped in this release</Lbl>
      {project.milestones.length === 0 && <div style={{ fontSize: 12, color: C.dim }}>This project has no milestones yet.</div>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {project.milestones.map((m) => {
          const on = d.milestoneIds.includes(m.id);
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => toggleMs(m.id)}
              aria-pressed={on}
              style={{
                ...ghostBtn,
                height: 28,
                color: on ? C.text : C.mut,
                background: on ? C.accentSoft2 : "transparent",
                borderColor: on ? C.accentLine2 : C.line2,
              }}
            >
              <span style={{ fontSize: 11, color: C.dim }}>{m.id}</span> {m.name}
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "16px 0 4px" }}>
        <span style={{ fontSize: 12, color: C.mut }}>Go-live criteria — every one must be met against live state</span>
        <button type="button" onClick={addCriterion} style={{ ...ghostBtn, border: "none", color: C.indigoHi }}>
          + Add criterion
        </button>
      </div>
      {d.criteria.length === 0 && (
        <div style={{ fontSize: 12, color: C.dim, background: C.inset, border: `1px dashed ${C.line2}`, borderRadius: 8, padding: 12 }}>
          No criteria — a release with none is always ready. Add a performance gate, a governance approval, or a manual sign-off.
        </div>
      )}
      {d.criteria.map((c, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "96px 1fr 26px", gap: 6, alignItems: "start", marginBottom: 8 }}>
          <select style={inpStyle} value={c.type} onChange={(e) => setCrit(i, retype(c, e.target.value as CritType, project))}>
            <option value="gate">Gate</option>
            <option value="gov">Governance</option>
            <option value="manual">Manual</option>
          </select>
          <div style={{ display: "grid", gap: 6 }}>
            {c.type === "gate" && (
              <select
                style={inpStyle}
                value={c.ms}
                onChange={(e) => {
                  const next: Criterion = { type: "gate", ms: e.target.value, label: c.label };
                  setCrit(i, { ...next, label: c.label === autoLabel(c, project) || c.label === "" ? autoLabel(next, project) : c.label });
                }}
              >
                {!project.milestones.some((m) => m.id === c.ms) && <option value={c.ms}>{c.ms || "choose a milestone"} (not in project)</option>}
                {project.milestones.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id} · {m.name}
                  </option>
                ))}
              </select>
            )}
            {c.type === "gov" && (
              <select
                style={inpStyle}
                value={c.gid}
                onChange={(e) => {
                  const next: Criterion = { type: "gov", gid: e.target.value, label: c.label };
                  setCrit(i, { ...next, label: c.label === autoLabel(c, project) || c.label === "" ? autoLabel(next, project) : c.label });
                }}
              >
                {!project.governance.some((g) => g.id === c.gid) && <option value={c.gid}>{c.gid || "choose an item"} (not tracked)</option>}
                {project.governance.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.cat} · {g.name}
                  </option>
                ))}
              </select>
            )}
            {c.type === "manual" && (
              <label style={{ display: "flex", alignItems: "center", gap: 8, height: 32, fontSize: 12.5, color: C.mut, cursor: "pointer" }}>
                <input type="checkbox" checked={c.ok} onChange={(e) => setCrit(i, { ...c, ok: e.target.checked })} style={{ accentColor: C.indigo }} />
                Confirmed
              </label>
            )}
            <input style={inpStyle} value={c.label} placeholder="Label shown on the release" onChange={(e) => setCrit(i, { ...c, label: e.target.value })} />
          </div>
          <Tip label="Remove criterion">
            <button
              type="button"
              aria-label="Remove criterion"
              className="vf-ghost"
              onClick={() => setD((x) => ({ ...x, criteria: x.criteria.filter((_, ci) => ci !== i) }))}
              style={{ ...ghostBtn, width: 26, height: 32, padding: 0, justifyContent: "center", border: "1px solid transparent" }}
            >
              ✕
            </button>
          </Tip>
        </div>
      ))}
    </Modal>
  );
}
