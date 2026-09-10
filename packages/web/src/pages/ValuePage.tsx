import { useState } from "react";
import { MONTHS, STATUS_LABEL, attainment, impactOf, isMeasurable, realized, tierOf } from "@valueflow/domain";
import type { Dim, ImpactPair, Milestone, Project } from "@valueflow/domain";
import { Burnup } from "../charts/Burnup.tsx";
import { EvalScatter } from "../charts/EvalScatter.tsx";
import { levelColor } from "../charts/small.tsx";
import { MilestoneEditor } from "../editors/MilestoneEditor.tsx";
import { TargetsEditor } from "../editors/TargetsEditor.tsx";
import { Caret, Chip, Kpi, Ring, SectionCard, StatusIcon, reset } from "../ui/primitives.tsx";
import { C, STATUS_COLOR } from "../theme.ts";

type MetricSetter = (mid: string, xid: string, v: number) => void;

function MilestoneRow({
  projectId,
  m,
  open,
  onToggle,
  onMetric,
  onEdit,
}: {
  projectId: string;
  m: Milestone;
  open: boolean;
  onToggle: () => void;
  onMetric: MetricSetter;
  onEdit: () => void;
}) {
  const t = tierOf(m);
  const measurable = isMeasurable(m);
  const attain = attainment(m);
  const [tab, setTab] = useState<"gates" | "evals">("gates");
  const ringColor = t === 2 ? C.green : t === 1 ? C.indigo : measurable ? C.amber : C.dim;
  return (
    <div style={{ borderTop: `1px solid ${C.line}` }}>
      <button
        type="button"
        onClick={onToggle}
        className="vf-row"
        style={{ ...reset, width: "100%", display: "flex", alignItems: "center", gap: 11, padding: "11px 14px", background: open ? C.panel2 : "transparent", transition: "background .12s" }}
      >
        <Ring pct={attain} color={ringColor} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 13.5, color: C.text, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</span>
          <span style={{ fontSize: 11, color: STATUS_COLOR[m.status], display: "inline-flex", alignItems: "center", gap: 5 }}>
            <StatusIcon status={m.status} /> {STATUS_LABEL[m.status]} · {MONTHS[m.month]}
          </span>
        </span>
        <span style={{ display: "flex", gap: 5 }}>
          {measurable && t > 0 ? (
            <>
              <Chip tone={t === 2 ? "good" : "accent"}>FTE −{impactOf(m, "fte")}%</Chip>
              <Chip tone={t === 2 ? "good" : "accent"}>Time −{impactOf(m, "time")}%</Chip>
            </>
          ) : measurable ? (
            <Chip tone="warn">below gate</Chip>
          ) : (
            <Chip>
              −{m.impact.base.fte}–{m.impact.stretch.fte}% / −{m.impact.base.time}–{m.impact.stretch.time}%
            </Chip>
          )}
        </span>
        <span
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          title="Edit milestone"
          style={{ color: C.dim, fontSize: 12, padding: "2px 5px", borderRadius: 4, border: `1px solid ${C.line2}` }}
        >
          ✎
        </span>
        <Caret open={open} />
      </button>
      {open && (
        <div style={{ padding: "2px 14px 16px 47px" }}>
          <div style={{ display: "flex", gap: 2, margin: "8px 0 10px", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 7, padding: 2, width: "fit-content" }}>
            {(["gates", "evals"] as const).map((tb) => (
              <button
                key={tb}
                type="button"
                onClick={() => setTab(tb)}
                style={{ ...reset, fontSize: 12, padding: "4px 12px", borderRadius: 5, color: tab === tb ? C.text : C.dim, background: tab === tb ? "#1E222D" : "transparent" }}
              >
                {tb === "gates" ? "Performance gates" : "Eval history"}
              </button>
            ))}
          </div>
          {tab === "gates" ? (
            <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, padding: "2px 14px 8px" }}>
              {m.metrics.length === 0 && <div style={{ fontSize: 12.5, color: C.dim, padding: "12px 0 8px" }}>No success criteria defined — this milestone can never clear a gate.</div>}
              {m.metrics.map((x) => {
                const st = levelColor(x, C.dim);
                return (
                  <div key={x.id} style={{ padding: "10px 0", borderTop: `1px solid ${C.line}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <span style={{ fontSize: 12.5, color: "#C6CAD6" }}>{x.label}</span>
                      <span style={{ fontSize: 12.5, color: st, fontWeight: 600 }}>{x.current}%</span>
                    </div>
                    <div style={{ position: "relative", height: 6, borderRadius: 3, background: "#1B1E27" }}>
                      <div style={{ position: "absolute", inset: 0, width: `${x.current}%`, background: st, borderRadius: 3, transition: "width .2s, background .2s" }} />
                      <div style={{ position: "absolute", top: -3, bottom: -3, left: `${x.base}%`, width: 1.5, background: C.indigo }} />
                      <div style={{ position: "absolute", top: -3, bottom: -3, left: `${x.stretch}%`, width: 1.5, background: C.green }} />
                    </div>
                    {measurable && (
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={x.current}
                        onChange={(e) => onMetric(m.id, x.id, Number(e.target.value))}
                        style={{ width: "100%", marginTop: 8, accentColor: C.indigo, height: 14 }}
                        aria-label={`Simulate ${x.label}`}
                      />
                    )}
                    <div style={{ display: "flex", gap: 14, marginTop: 4, fontSize: 10.5, fontVariantNumeric: "tabular-nums" }}>
                      <span style={{ color: C.indigo }}>base ≥ {x.base}%</span>
                      <span style={{ color: C.green }}>stretch ≥ {x.stretch}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, padding: "10px 8px 4px" }}>
              {measurable ? (
                m.metrics.map((x) => (
                  <div key={x.id} style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: 12, color: C.mut, padding: "0 6px 4px" }}>{x.label}</div>
                    <EvalScatter projectId={projectId} milestoneId={m.id} metric={x} />
                  </div>
                ))
              ) : (
                <div style={{ fontSize: 12.5, color: C.dim, padding: "14px 10px 18px" }}>No eval runs yet. Connect an eval suite when this milestone reaches In eval.</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ValuePage({
  p,
  onMetric,
  openMs,
  setOpenMs,
  dim,
  setDim,
  onSaveMilestone,
  onDeleteMilestone,
  onSaveTargets,
}: {
  p: Project;
  onMetric: (pid: string, mid: string, xid: string, v: number) => void;
  openMs: string | null;
  setOpenMs: (id: string | null) => void;
  dim: Dim;
  setDim: (d: Dim) => void;
  onSaveMilestone: (pid: string, ms: Milestone, isNew: boolean) => void;
  onDeleteMilestone: (pid: string, mid: string) => void;
  onSaveTargets: (pid: string, t: ImpactPair) => void;
}) {
  const [editing, setEditing] = useState<"new" | string | null>(null);
  const [editTargets, setEditTargets] = useState(false);
  const fte = realized(p, "fte");
  const time = realized(p, "time");
  const gates = p.milestones.filter((m) => tierOf(m) > 0).length;
  const measurable = p.milestones.filter(isMeasurable).length;
  const dims: [Dim, string][] = [
    ["fte", "FTE"],
    ["time", "Time"],
  ];
  return (
    <div style={{ paddingBottom: 30 }}>
      <section style={{ display: "flex", gap: 12, padding: "16px 20px 4px", flexWrap: "wrap" }}>
        <Kpi label="FTE reduction realized" value={`${fte}%`} sub={`of ${p.targets.fte}% target`} color={C.indigoHi} ring={p.targets.fte ? fte / p.targets.fte : 0} />
        <Kpi label="Time reduction realized" value={`${time}%`} sub={`of ${p.targets.time}% target`} color={C.indigoHi} ring={p.targets.time ? time / p.targets.time : 0} />
        <Kpi label="Gates cleared" value={`${gates}/${measurable}`} sub="measurable milestones" color={C.green} />
      </section>
      <section style={{ padding: "14px 20px 6px" }}>
        <SectionCard
          title="Value burn-up"
          pad="8px 14px 6px"
          right={
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button type="button" onClick={() => setEditTargets(true)} style={{ ...reset, fontSize: 11.5, color: C.dim, padding: "3px 9px", border: `1px solid ${C.line2}`, borderRadius: 6 }}>
                Edit targets
              </button>
              <div style={{ display: "flex", gap: 2, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 7, padding: 2 }}>
                {dims.map(([k, l]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setDim(k)}
                    style={{ ...reset, fontSize: 12, padding: "3px 12px", borderRadius: 5, color: dim === k ? C.text : C.dim, background: dim === k ? "#1E222D" : "transparent" }}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
          }
        >
          <Burnup milestones={p.milestones} dim={dim} target={p.targets[dim]} />
          <div style={{ display: "flex", gap: 16, padding: "8px 4px 4px", fontSize: 11, color: C.dim, flexWrap: "wrap" }}>
            <span>
              <span style={{ color: C.indigo }}>—</span> realized
            </span>
            <span>
              <span style={{ color: C.indigoHi }}>--</span> committed (base gates)
            </span>
            <span>
              <span style={{ color: C.dim }}>··</span> stretch ceiling
            </span>
            <span>
              <span style={{ color: C.red }}>--</span> target
            </span>
          </div>
        </SectionCard>
      </section>
      <section>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 20px 8px" }}>
          <span style={{ fontSize: 12.5, color: C.mut }}>Milestones — drag gate sliders to simulate eval results</span>
          <button type="button" onClick={() => setEditing("new")} style={{ ...reset, fontSize: 12.5, color: C.indigoHi }}>
            + New milestone
          </button>
        </div>
        <div style={{ margin: "0 20px", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, overflow: "hidden" }}>
          {p.milestones.map((m) => (
            <MilestoneRow
              key={m.id}
              projectId={p.id}
              m={m}
              open={openMs === m.id}
              onToggle={() => setOpenMs(openMs === m.id ? null : m.id)}
              onMetric={(mid, xid, v) => onMetric(p.id, mid, xid, v)}
              onEdit={() => setEditing(m.id)}
            />
          ))}
          {p.milestones.length === 0 && <div style={{ fontSize: 12.5, color: C.dim, padding: "16px 14px" }}>No milestones yet.</div>}
        </div>
      </section>
      {editing && (
        <MilestoneEditor
          project={p}
          milestoneId={editing === "new" ? null : editing}
          onSave={(ms, isNew) => {
            onSaveMilestone(p.id, ms, isNew);
            setEditing(null);
          }}
          onDelete={(mid) => {
            onDeleteMilestone(p.id, mid);
            setEditing(null);
            if (openMs === mid) setOpenMs(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}
      {editTargets && (
        <TargetsEditor
          targets={p.targets}
          onSave={(t) => {
            onSaveTargets(p.id, t);
            setEditTargets(false);
          }}
          onClose={() => setEditTargets(false)}
        />
      )}
    </div>
  );
}
