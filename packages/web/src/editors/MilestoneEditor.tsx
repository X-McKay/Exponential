import { useState } from "react";
import { MILESTONE_STATUSES, STATUS_LABEL, addMonths, monthLabel, nextMilestoneId, planningMonths } from "@valueflow/domain";
import type { Calendar, Dim, Metric, Milestone, MilestoneStatus, Project } from "@valueflow/domain";
import { Btn, Lbl, Modal, Tip, ghostBtn, inpStyle, reset } from "../ui/primitives.tsx";
import { C } from "../theme.ts";

const num = (v: string): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
const pctOk = (n: number): boolean => Number.isFinite(n) && n >= 0 && n <= 100;

const isStatus = (s: string): s is MilestoneStatus => (MILESTONE_STATUSES as readonly string[]).includes(s);

const blank = (project: Project, cal: Calendar): Milestone => ({
  id: nextMilestoneId(project),
  name: "",
  status: "backlog",
  month: addMonths(cal.todayYm, 2),
  impact: { base: { fte: 5, time: 5 }, stretch: { fte: 8, time: 8 } },
  metrics: [],
});

export function MilestoneEditor({
  project,
  milestoneId,
  cal,
  onSave,
  onDelete,
  onClose,
}: {
  project: Project;
  milestoneId: string | null;
  cal: Calendar;
  onSave: (ms: Milestone, isNew: boolean) => Promise<unknown>;
  onDelete: (mid: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const existing = project.milestones.find((m) => m.id === milestoneId);
  const isNew = !existing;
  const [d, setD] = useState<Milestone>(() => (existing ? structuredClone(existing) : blank(project, cal)));
  const months = planningMonths(cal);
  const [confirmDel, setConfirmDel] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const set = (patch: Partial<Milestone>) => setD((x) => ({ ...x, ...patch }));
  const setImpact = (tier: "base" | "stretch", dim: Dim, v: number) => setD((x) => ({ ...x, impact: { ...x.impact, [tier]: { ...x.impact[tier], [dim]: v } } }));
  const setMetric = (i: number, patch: Partial<Metric>) => setD((x) => ({ ...x, metrics: x.metrics.map((m, mi) => (mi === i ? { ...m, ...patch } : m)) }));
  const addMetric = () => setD((x) => ({ ...x, metrics: [...x.metrics, { id: `m${Date.now() % 100000}`, label: "", base: 80, stretch: 95, current: 0 }] }));
  const rmMetric = (i: number) => setD((x) => ({ ...x, metrics: x.metrics.filter((_, mi) => mi !== i) }));
  const impactOk = pctOk(d.impact.base.fte) && pctOk(d.impact.base.time) && pctOk(d.impact.stretch.fte) && pctOk(d.impact.stretch.time) && d.impact.stretch.fte >= d.impact.base.fte && d.impact.stretch.time >= d.impact.base.time;
  const metricsOk = d.metrics.every((m) => m.label.trim().length > 0 && pctOk(m.base) && pctOk(m.stretch) && m.stretch >= m.base);
  const problems: string[] = [
    ...(d.name.trim() ? [] : ["a name"]),
    ...(impactOk ? [] : ["impact percentages between 0 and 100 with stretch at or above base"]),
    ...(metricsOk ? [] : ["a label and gates between 0 and 100 with stretch at or above base for every metric"]),
  ];
  const valid = problems.length === 0;
  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave({ ...d, name: d.name.trim(), metrics: d.metrics.map((m) => ({ ...m, label: m.label.trim() })) }, isNew);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onDelete(d.id);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <Modal
      title={isNew ? "New milestone" : `Edit ${d.id}`}
      onClose={onClose}
      onSubmit={() => void submit()}
      footer={
        <>
          {!isNew && (
            <span style={{ marginRight: "auto" }}>
              <Btn tone="danger" disabled={saving} onClick={() => (confirmDel ? void remove() : setConfirmDel(true))}>
                {confirmDel ? "Confirm delete" : "Delete"}
              </Btn>
            </span>
          )}
          <Btn onClick={onClose}>Cancel</Btn>
          <Tip label={valid ? (isNew ? "Create the milestone" : "Save changes") : `Needs ${problems.join("; ")}`}>
            <Btn tone="primary" disabled={!valid || saving} onClick={() => void submit()}>
              {saving ? "Saving…" : isNew ? "Create milestone" : "Save changes"}
            </Btn>
          </Tip>
        </>
      }
    >
      {saveError && <div role="alert" style={{ color: C.redHi, fontSize: 12, margin: "8px 0" }}>Could not save: {saveError}</div>}
      <Lbl htmlFor="vf-milestoneeditor-name">Name</Lbl>
      <input id="vf-milestoneeditor-name" style={inpStyle} value={d.name} placeholder="e.g. Entity resolution service" onChange={(e) => set({ name: e.target.value })} />

      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <Lbl htmlFor="vf-milestoneeditor-status">Status</Lbl>
          <select id="vf-milestoneeditor-status"
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
          <Lbl htmlFor="vf-milestoneeditor-target-ship-month">Target / ship month</Lbl>
          <select id="vf-milestoneeditor-target-ship-month" style={inpStyle} value={d.month} onChange={(e) => set({ month: e.target.value })}>
            {!months.includes(d.month) && <option value={d.month}>{d.month}</option>}
            {months.map((mo) => (
              <option key={mo} value={mo}>
                {monthLabel(mo, cal.todayYm)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <Lbl>Value impact — reduction contributed when the gate clears</Lbl>
      <div style={{ display: "grid", gridTemplateColumns: "70px 1fr 1fr", gap: 8, alignItems: "center", background: C.inset, border: `1px solid ${C.line}`, borderRadius: 8, padding: 10 }}>
        <span />
        <span style={{ fontSize: 11, color: C.dim }}>FTE %</span>
        <span style={{ fontSize: 11, color: C.dim }}>Time %</span>
        <span style={{ fontSize: 12, color: C.indigoSoft }}>Base</span>
        <input type="number" min={0} max={100} style={inpStyle} value={d.impact.base.fte} onChange={(e) => setImpact("base", "fte", num(e.target.value))} />
        <input type="number" min={0} max={100} style={inpStyle} value={d.impact.base.time} onChange={(e) => setImpact("base", "time", num(e.target.value))} />
        <span style={{ fontSize: 12, color: C.greenHi }}>Stretch</span>
        <input type="number" min={0} max={100} style={{ ...inpStyle, borderColor: d.impact.stretch.fte >= d.impact.base.fte ? C.line2 : C.badLine2 }} value={d.impact.stretch.fte} onChange={(e) => setImpact("stretch", "fte", num(e.target.value))} />
        <input type="number" min={0} max={100} style={{ ...inpStyle, borderColor: d.impact.stretch.time >= d.impact.base.time ? C.line2 : C.badLine2 }} value={d.impact.stretch.time} onChange={(e) => setImpact("stretch", "time", num(e.target.value))} />
      </div>
      {!impactOk && <div style={{ fontSize: 11.5, color: C.redHi, marginTop: 6 }}>Impact is a percentage between 0 and 100; stretch cannot sit below base.</div>}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "14px 0 4px" }}>
        <span style={{ fontSize: 12, color: C.mut }}>Success criteria — all must clear base for base impact, all must clear stretch for stretch impact</span>
      </div>
      {d.metrics.length === 0 && (
        <div style={{ fontSize: 12, color: C.dim, background: C.inset, border: `1px dashed ${C.line2}`, borderRadius: 8, padding: "12px 12px", marginBottom: 6 }}>
          No criteria yet — without at least one, this milestone can never clear a gate or realize value.
        </div>
      )}
      {d.metrics.map((mx, i) => (
        <div key={mx.id} className="vf-fields" style={{ display: "grid", gridTemplateColumns: "1fr 62px 62px 26px", gap: 6, alignItems: "end", marginBottom: 6 }}>
          <div>
            {i === 0 && <div style={{ fontSize: 11, color: C.dim, marginBottom: 3 }}>Metric</div>}
            <input style={inpStyle} value={mx.label} placeholder="e.g. Mapping accuracy" onChange={(e) => setMetric(i, { label: e.target.value })} />
          </div>
          <div>
            {i === 0 && <div style={{ fontSize: 11, color: C.indigoSoft, marginBottom: 3 }}>Base ≥</div>}
            <input type="number" min={0} max={100} style={inpStyle} value={mx.base} aria-label="Base gate" onChange={(e) => setMetric(i, { base: num(e.target.value) })} />
          </div>
          <div>
            {i === 0 && <div style={{ fontSize: 11, color: C.greenHi, marginBottom: 3 }}>Stretch ≥</div>}
            <input type="number" min={0} max={100} style={{ ...inpStyle, borderColor: mx.stretch >= mx.base ? C.line2 : C.badLine2 }} value={mx.stretch} aria-label="Stretch gate" onChange={(e) => setMetric(i, { stretch: num(e.target.value) })} />
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
