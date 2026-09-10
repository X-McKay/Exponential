import { useState } from "react";
import { MILESTONE_STATUSES, MONTHS, STATUS_LABEL, TODAY, nextMilestoneId } from "@valueflow/domain";
import type { Dim, Metric, Milestone, MilestoneStatus, Project } from "@valueflow/domain";
import { Btn, Lbl, Modal, Tip, ghostBtn, inpStyle, reset } from "../ui/primitives.tsx";
import { C } from "../theme.ts";

const num = (v: string): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

const isStatus = (s: string): s is MilestoneStatus => (MILESTONE_STATUSES as readonly string[]).includes(s);

const blank = (project: Project): Milestone => ({
  id: nextMilestoneId(project),
  name: "",
  status: "backlog",
  month: Math.min(TODAY + 2, MONTHS.length - 1),
  impact: { base: { fte: 5, time: 5 }, stretch: { fte: 8, time: 8 } },
  metrics: [],
});

export function MilestoneEditor({
  project,
  milestoneId,
  onSave,
  onDelete,
  onClose,
}: {
  project: Project;
  milestoneId: string | null;
  onSave: (ms: Milestone, isNew: boolean) => void;
  onDelete: (mid: string) => void;
  onClose: () => void;
}) {
  const existing = project.milestones.find((m) => m.id === milestoneId);
  const isNew = !existing;
  const [d, setD] = useState<Milestone>(() => (existing ? structuredClone(existing) : blank(project)));
  const [confirmDel, setConfirmDel] = useState(false);
  const set = (patch: Partial<Milestone>) => setD((x) => ({ ...x, ...patch }));
  const setImpact = (tier: "base" | "stretch", dim: Dim, v: number) => setD((x) => ({ ...x, impact: { ...x.impact, [tier]: { ...x.impact[tier], [dim]: v } } }));
  const setMetric = (i: number, patch: Partial<Metric>) => setD((x) => ({ ...x, metrics: x.metrics.map((m, mi) => (mi === i ? { ...m, ...patch } : m)) }));
  const addMetric = () => setD((x) => ({ ...x, metrics: [...x.metrics, { id: `m${Date.now() % 100000}`, label: "", base: 80, stretch: 95, current: 0 }] }));
  const rmMetric = (i: number) => setD((x) => ({ ...x, metrics: x.metrics.filter((_, mi) => mi !== i) }));
  const valid = d.name.trim().length > 0 && d.metrics.every((m) => m.label.trim().length > 0);
  const submit = () => {
    if (valid) onSave({ ...d, name: d.name.trim(), metrics: d.metrics.map((m) => ({ ...m, label: m.label.trim() })) }, isNew);
  };

  return (
    <Modal
      title={isNew ? "New milestone" : `Edit ${d.id}`}
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          {!isNew && (
            <span style={{ marginRight: "auto" }}>
              <Btn tone="danger" onClick={() => (confirmDel ? onDelete(d.id) : setConfirmDel(true))}>
                {confirmDel ? "Confirm delete" : "Delete"}
              </Btn>
            </span>
          )}
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn tone="primary" disabled={!valid} onClick={submit}>
            {isNew ? "Create milestone" : "Save changes"}
          </Btn>
        </>
      }
    >
      <Lbl>Name</Lbl>
      <input style={inpStyle} value={d.name} placeholder="e.g. Entity resolution service" onChange={(e) => set({ name: e.target.value })} />

      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <Lbl>Status</Lbl>
          <select
            style={inpStyle}
            value={d.status}
            onChange={(e) => {
              if (isStatus(e.target.value)) set({ status: e.target.value });
            }}
          >
            {MILESTONE_STATUSES.map((k) => (
              <option key={k} value={k}>
                {STATUS_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <Lbl>Target / ship month</Lbl>
          <select style={inpStyle} value={d.month} onChange={(e) => set({ month: Number(e.target.value) })}>
            {MONTHS.map((mo, i) => (
              <option key={mo} value={i}>
                {mo}
              </option>
            ))}
          </select>
        </div>
      </div>

      <Lbl>Value impact — reduction contributed when the gate clears</Lbl>
      <div style={{ display: "grid", gridTemplateColumns: "70px 1fr 1fr", gap: 8, alignItems: "center", background: "#0E1015", border: `1px solid ${C.line}`, borderRadius: 8, padding: 10 }}>
        <span />
        <span style={{ fontSize: 11, color: C.dim }}>FTE %</span>
        <span style={{ fontSize: 11, color: C.dim }}>Time %</span>
        <span style={{ fontSize: 12, color: "#A5AEF7" }}>Base</span>
        <input type="number" style={inpStyle} value={d.impact.base.fte} onChange={(e) => setImpact("base", "fte", num(e.target.value))} />
        <input type="number" style={inpStyle} value={d.impact.base.time} onChange={(e) => setImpact("base", "time", num(e.target.value))} />
        <span style={{ fontSize: 12, color: "#6FD6A4" }}>Stretch</span>
        <input type="number" style={inpStyle} value={d.impact.stretch.fte} onChange={(e) => setImpact("stretch", "fte", num(e.target.value))} />
        <input type="number" style={inpStyle} value={d.impact.stretch.time} onChange={(e) => setImpact("stretch", "time", num(e.target.value))} />
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "14px 0 4px" }}>
        <span style={{ fontSize: 12, color: C.mut }}>Success criteria — all must clear base for base impact, all must clear stretch for stretch impact</span>
      </div>
      {d.metrics.length === 0 && (
        <div style={{ fontSize: 12, color: C.dim, background: "#0E1015", border: `1px dashed ${C.line2}`, borderRadius: 8, padding: "12px 12px", marginBottom: 6 }}>
          No criteria yet — without at least one, this milestone can never clear a gate or realize value.
        </div>
      )}
      {d.metrics.map((mx, i) => (
        <div key={mx.id} style={{ display: "grid", gridTemplateColumns: "1fr 62px 62px 62px 26px", gap: 6, alignItems: "end", marginBottom: 6 }}>
          <div>
            {i === 0 && <div style={{ fontSize: 11, color: C.dim, marginBottom: 3 }}>Metric</div>}
            <input style={inpStyle} value={mx.label} placeholder="e.g. Mapping accuracy" onChange={(e) => setMetric(i, { label: e.target.value })} />
          </div>
          <div>
            {i === 0 && <div style={{ fontSize: 11, color: "#A5AEF7", marginBottom: 3 }}>Base ≥</div>}
            <input type="number" style={inpStyle} value={mx.base} onChange={(e) => setMetric(i, { base: num(e.target.value) })} />
          </div>
          <div>
            {i === 0 && <div style={{ fontSize: 11, color: "#6FD6A4", marginBottom: 3 }}>Stretch ≥</div>}
            <input type="number" style={inpStyle} value={mx.stretch} onChange={(e) => setMetric(i, { stretch: num(e.target.value) })} />
          </div>
          <div>
            {i === 0 && <div style={{ fontSize: 11, color: C.dim, marginBottom: 3 }}>Current</div>}
            <input type="number" style={inpStyle} value={mx.current} onChange={(e) => setMetric(i, { current: num(e.target.value) })} />
          </div>
          <Tip label="Remove criterion">
            <button type="button" onClick={() => rmMetric(i)} aria-label="Remove criterion" className="vf-ghost" style={{ ...ghostBtn, width: 26, height: 32, padding: 0, justifyContent: "center", border: "1px solid transparent" }}>
              ✕
            </button>
          </Tip>
        </div>
      ))}
      <button type="button" onClick={addMetric} style={{ ...reset, fontSize: 12, color: C.indigoHi, padding: "4px 0" }}>
        + Add criterion
      </button>
    </Modal>
  );
}
