import { useEffect, useMemo, useRef, useState } from "react";
import { STATUS_LABEL, attainment, explainGatesCleared, explainRealized, explainTier, impactOf, isMeasurable, monthLabel, realized, tierOf } from "@valueflow/domain";
import type { Calendar, Dim, ImpactPair, Milestone, Project } from "@valueflow/domain";
import { Burnup } from "../charts/Burnup.tsx";
import { EvalScatter } from "../charts/EvalScatter.tsx";
import { levelColor } from "../charts/small.tsx";
import { MilestoneEditor } from "../editors/MilestoneEditor.tsx";
import { TargetsEditor } from "../editors/TargetsEditor.tsx";
import { Why } from "../ui/Explain.tsx";
import { Btn, Caret, Chip, Kpi, Ring, SectionCard, StatusIcon, Tip, ghostBtn, reset } from "../ui/primitives.tsx";
import { C, STATUS_COLOR } from "../theme.ts";
import { applyScenarioValues, hasScenarioValues, scenarioMetricKey } from "./valueScenario.ts";

type MetricSetter = (mid: string, xid: string, v: number) => void;
type RecordMeasurement = (mid: string, xid: string, v: number) => Promise<void>;

function MilestoneRow({
  projectId,
  m,
  cal,
  open,
  onToggle,
  onMetric,
  onRecord,
  scenario,
  recording,
  recorded,
  onEdit,
}: {
  projectId: string;
  m: Milestone;
  cal: Calendar;
  open: boolean;
  onToggle: () => void;
  onMetric: MetricSetter;
  onRecord: RecordMeasurement;
  scenario: boolean;
  recording: string | null;
  recorded: Set<string>;
  onEdit: () => void;
}) {
  const t = tierOf(m);
  const measurable = isMeasurable(m);
  const attain = attainment(m);
  const [tab, setTab] = useState<"gates" | "evals">("gates");
  const ringColor = t === 2 ? C.green : t === 1 ? C.indigo : measurable ? C.amber : C.dim;
  return (
    <div id={`milestone-${m.id}`} tabIndex={-1} style={{ borderTop: `1px solid ${C.line}`, scrollMarginTop: 64 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, paddingRight: 12, flexWrap: "wrap" }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={`${open ? "Collapse" : "Expand"} ${m.name}`}
        className="vf-row"
        style={{ ...reset, flex: "1 1 200px", minWidth: 0, display: "flex", alignItems: "center", gap: 11, padding: "11px 14px", background: open ? C.panel2 : "transparent", transition: "background .12s" }}
      >
        <Ring pct={attain} color={ringColor} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 14, color: C.text, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</span>
          <span style={{ fontSize: 11, color: STATUS_COLOR[m.status], display: "inline-flex", alignItems: "center", gap: 5 }}>
            <StatusIcon status={m.status} /> {STATUS_LABEL[m.status]} · {monthLabel(m.month, cal.todayYm)}
          </span>
        </span>
        <Caret open={open} />
      </button>
        <Why e={() => explainTier({ id: projectId }, m)} style={{ display: "flex", gap: 5, borderBottom: "none" }}>
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
        </Why>
        <Tip label="Edit milestone">
          <button
            type="button"
            aria-label={`Edit ${m.name}`}
            className="vf-ghost"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            style={{ ...ghostBtn, width: 40, height: 40, padding: 0, justifyContent: "center", color: C.dim }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8.5 1.5l2 2L4 10H2V8z" />
            </svg>
          </button>
        </Tip>
      </div>
      {open && (
        <div style={{ padding: "2px 14px 16px 47px" }}>
          <div style={{ display: "flex", gap: 2, margin: "8px 0 10px", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 6, padding: 2, width: "fit-content" }}>
            {(["gates", "evals"] as const).map((tb) => (
              <button
                key={tb}
                type="button"
                onClick={() => setTab(tb)}
                style={{ ...reset, fontSize: 12, padding: "4px 12px", borderRadius: 6, color: tab === tb ? C.text : C.dim, background: tab === tb ? C.field : "transparent" }}
              >
                {tb === "gates" ? "Performance gates" : "Eval history"}
              </button>
            ))}
          </div>
          {tab === "gates" ? (
            <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, padding: "2px 14px 8px" }}>
              {m.metrics.length === 0 && <div style={{ fontSize: 13, color: C.dim, padding: "12px 0 8px" }}>No success criteria defined — this milestone can never clear a gate.</div>}
              {m.metrics.map((x) => {
                const st = levelColor(x, C.dim);
                return (
                  <div key={x.id} style={{ padding: "10px 0", borderTop: `1px solid ${C.line}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <span style={{ fontSize: 13, color: C.text2 }}>{x.label}</span>
                      <span style={{ fontSize: 13, color: st, fontWeight: 500 }}>{x.current === null ? "unmeasured" : `${x.current}%`}</span>
                    </div>
                    <div style={{ position: "relative", height: 6, borderRadius: 4, background: C.field }}>
                      <div style={{ position: "absolute", inset: 0, width: `${x.current ?? 0}%`, background: st, borderRadius: 4, transition: "width .2s, background .2s" }} />
                      <div style={{ position: "absolute", top: -3, bottom: -3, left: `${x.base}%`, width: 1.5, background: C.indigo }} />
                      <div style={{ position: "absolute", top: -3, bottom: -3, left: `${x.stretch}%`, width: 1.5, background: C.green }} />
                    </div>
                    {measurable && (
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={x.current ?? 0}
                        onChange={(e) => onMetric(m.id, x.id, Number(e.target.value))}
                        style={{ width: "100%", marginTop: 8, accentColor: C.indigo, height: 14 }}
                        aria-label={`${scenario ? "Scenario" : "Local scenario"} value for ${x.label}`}
                      />
                    )}
                    {measurable && (
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                        <button
                          type="button"
                          className="vf-ghost"
                          disabled={recording === scenarioMetricKey(m.id, x.id)}
                          onClick={() => void onRecord(m.id, x.id, x.current)}
                          style={{ ...ghostBtn, height: 25, color: C.indigoHi, opacity: recording === scenarioMetricKey(m.id, x.id) ? 0.55 : 1 }}
                        >
                          {recording === scenarioMetricKey(m.id, x.id) ? "Recording…" : "Record measurement"}
                        </button>
                        <span style={{ fontSize: 11, color: recorded.has(scenarioMetricKey(m.id, x.id)) ? C.green : C.dim }}>
                          {recorded.has(scenarioMetricKey(m.id, x.id)) ? "Source: manual · recorded" : "Source: manual when recorded"}
                        </span>
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 14, marginTop: 4, fontSize: 11, fontVariantNumeric: "tabular-nums" }}>
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
                <div style={{ fontSize: 13, color: C.dim, padding: "14px 10px 18px" }}>No eval runs yet. Connect an eval suite when this milestone reaches In eval.</div>
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
  cal,
  openMs,
  focusId,
  setOpenMs,
  dim,
  setDim,
  onSaveMilestone,
  onDeleteMilestone,
  onSaveTargets,
  onRecordMeasurement,
}: {
  p: Project;
  cal: Calendar;
  openMs: string | null;
  focusId?: string | undefined;
  setOpenMs: (id: string | null) => void;
  dim: Dim;
  setDim: (d: Dim) => void;
  onSaveMilestone: (pid: string, ms: Milestone, isNew: boolean) => Promise<unknown>;
  onDeleteMilestone: (pid: string, mid: string) => Promise<unknown>;
  onSaveTargets: (pid: string, t: ImpactPair) => Promise<unknown>;
  onRecordMeasurement: (pid: string, mid: string, xid: string, v: number) => Promise<void>;
}) {
  useEffect(() => {
    if (!focusId) return;
    setOpenMs(focusId);
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(`milestone-${focusId}`);
      target?.scrollIntoView({ block: "start" });
      target?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusId, p.id, setOpenMs]);
  const [editing, setEditing] = useState<"new" | string | null>(null);
  const [editTargets, setEditTargets] = useState(false);
  const [scenarioValues, setScenarioValues] = useState<Record<string, number>>({});
  const [recording, setRecording] = useState<string | null>(null);
  const recordingRef = useRef<string | null>(null);
  const [recorded, setRecorded] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    setScenarioValues({});
    setRecorded(new Set());
    recordingRef.current = null;
    setRecording(null);
  }, [p.id]);
  const scenarioMilestones = useMemo(
    () => applyScenarioValues(p.milestones, scenarioValues),
    [p.milestones, scenarioValues],
  );
  const scenarioActive = hasScenarioValues(scenarioValues);
  const displayProject = scenarioActive ? { ...p, milestones: scenarioMilestones } : p;
  const fte = realized(displayProject, "fte");
  const time = realized(displayProject, "time");
  const gates = displayProject.milestones.filter((m) => tierOf(m) > 0).length;
  const measurable = displayProject.milestones.filter(isMeasurable).length;
  const dims: [Dim, string][] = [
    ["fte", "FTE"],
    ["time", "Time"],
  ];
  return (
    <div style={{ paddingBottom: 30 }}>
      {scenarioActive && (
        <div role="status" style={{ margin: "14px 20px 0", padding: "10px 12px", border: `1px solid ${C.accentLine2}`, borderRadius: 8, background: C.accentSoft, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ color: C.indigoHi, fontWeight: 550 }}>Scenario mode</span>
          <span style={{ color: C.mut, fontSize: 12, flex: 1 }}>Slider changes are local estimates. They do not change evidence, gates, releases, or the workspace.</span>
          <button type="button" className="vf-ghost" onClick={() => { setScenarioValues({}); setRecorded(new Set()); recordingRef.current = null; setRecording(null); }} style={{ ...ghostBtn, height: 26 }}>Reset scenario</button>
        </div>
      )}
      <section style={{ display: "flex", gap: 12, padding: "16px 20px 4px", flexWrap: "wrap" }}>
        <Kpi label={scenarioActive ? "FTE reduction scenario" : "FTE reduction eligible"} value={<Why e={() => explainRealized(displayProject, "fte")}>{`${fte}%`}</Why>} sub={`of ${p.targets.fte}% target`} color={C.indigoHi} ring={p.targets.fte ? fte / p.targets.fte : 0} />
        <Kpi label={scenarioActive ? "Time reduction scenario" : "Time reduction eligible"} value={<Why e={() => explainRealized(displayProject, "time")}>{`${time}%`}</Why>} sub={`of ${p.targets.time}% target`} color={C.indigoHi} ring={p.targets.time ? time / p.targets.time : 0} />
        <Kpi label={scenarioActive ? "Scenario gates cleared" : "Gates cleared"} value={<Why e={() => explainGatesCleared(displayProject)}>{`${gates}/${measurable}`}</Why>} sub="measurable milestones" color={C.green} />
      </section>
      <section style={{ padding: "14px 20px 6px" }}>
        <SectionCard
          title="Value burn-up"
          pad="8px 14px 6px"
          right={
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button type="button" onClick={() => setEditTargets(true)} className="vf-ghost" style={ghostBtn}>
                Edit targets
              </button>
              <div style={{ display: "flex", gap: 2, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 6, padding: 2 }}>
                {dims.map(([k, l]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setDim(k)}
                    style={{ ...reset, fontSize: 12, padding: "3px 12px", borderRadius: 6, color: dim === k ? C.text : C.dim, background: dim === k ? C.field : "transparent" }}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
          }
        >
          <Burnup milestones={displayProject.milestones} historicalMilestones={scenarioActive ? undefined : p.historicalMilestones} dim={dim} target={p.targets[dim]} cal={cal} />
          <div style={{ display: "flex", gap: 16, padding: "8px 4px 4px", fontSize: 11, color: C.dim, flexWrap: "wrap" }}>
            <span>
              <span style={{ color: C.indigo }}>—</span> eligible
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
          <span style={{ fontSize: 13, color: C.mut }}>{scenarioActive ? "Milestones — scenario values shown locally" : "Milestones — explore a local scenario with the sliders"}</span>
          <button type="button" onClick={() => setEditing("new")} style={{ ...reset, fontSize: 13, color: C.indigoHi }}>
            + New milestone
          </button>
        </div>
        <div style={{ margin: "0 20px", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, overflow: "hidden" }}>
          {scenarioMilestones.map((m) => (
            <MilestoneRow
              key={m.id}
              projectId={p.id}
              m={m}
              cal={cal}
              open={openMs === m.id}
              onToggle={() => setOpenMs(openMs === m.id ? null : m.id)}
              onMetric={(mid, xid, v) => setScenarioValues((values) => ({ ...values, [scenarioMetricKey(mid, xid)]: v }))}
              onRecord={async (mid, xid, v) => {
                const key = scenarioMetricKey(mid, xid);
                if (recordingRef.current) return;
                recordingRef.current = key;
                setRecording(key);
                try {
                  await onRecordMeasurement(p.id, mid, xid, v);
                  setRecorded((values) => new Set(values).add(key));
                } finally {
                  recordingRef.current = null;
                  setRecording((current) => (current === key ? null : current));
                }
              }}
              scenario={scenarioActive}
              recording={recording}
              recorded={recorded}
              onEdit={() => setEditing(m.id)}
            />
          ))}
          {p.milestones.length === 0 && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "36px 14px" }}>
              <div style={{ fontSize: 13, color: C.text }}>No milestones yet</div>
              <div style={{ fontSize: 12, color: C.dim, textAlign: "center", maxWidth: 360 }}>Milestones carry the impact this project can realize once their eval metrics clear a gate.</div>
              <Btn onClick={() => setEditing("new")}>+ New milestone</Btn>
            </div>
          )}
        </div>
      </section>
      {editing && (
        <MilestoneEditor
          project={p}
          milestoneId={editing === "new" ? null : editing}
          cal={cal}
          onSave={async (ms, isNew) => {
            await onSaveMilestone(p.id, ms, isNew);
            setEditing(null);
          }}
          onDelete={async (mid) => {
            await onDeleteMilestone(p.id, mid);
            setEditing(null);
            if (openMs === mid) setOpenMs(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}
      {editTargets && (
        <TargetsEditor
          targets={p.targets}
          onSave={async (t) => {
            await onSaveTargets(p.id, t);
            setEditTargets(false);
          }}
          onClose={() => setEditTargets(false)}
        />
      )}
    </div>
  );
}
