import { useState } from "react";
import { isMeasurable, monthLabel, STATUS_LABEL, tierOf } from "@valueflow/domain";
import type { Calendar, Milestone, Project, Release, ReleaseState } from "@valueflow/domain";
import { C, releaseToneColor, STATUS_COLOR } from "../theme.ts";

export const gateDotColor = (m: Milestone): string => {
  const tier = tierOf(m);
  if (tier === 2) return C.green;
  if (tier === 1) return C.indigo;
  return isMeasurable(m) ? C.amber : C.dim;
};

const dateMs = (date: string): number => Date.parse(`${date}T00:00:00Z`);
const nextMonth = (month: string): string => {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString().slice(0, 7);
};
const targetDate = (m: Milestone): string => m.plannedEnd ?? `${m.month}-15`;
const shortDate = (date: string): string => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const tierLabel = (m: Milestone): string => {
  const tier = tierOf(m);
  return tier === 2 ? "stretch gate" : tier === 1 ? "base gate" : isMeasurable(m) ? "below gate" : "unmeasured";
};
const truncate = (value: string, length: number): string => value.length > length ? `${value.slice(0, length - 1)}…` : value;
type Selection = { kind: "milestone" | "release"; id: string } | null;

export function RoadmapTimeline({ p, releases, states, onPick, picked, cal }: {
  p: Project;
  releases: Release[];
  states: ReleaseState[];
  onPick: (id: string) => void;
  picked: string | null;
  cal: Calendar;
}) {
  const [selection, setSelection] = useState<Selection>(null);
  const W = 1120, LABEL_W = 252, X0 = LABEL_W + 18, X1 = W - 24, TOP = 34, ROW_H = 58;
  const releaseY = TOP + 28;
  const rowStart = TOP + (releases.length ? 62 : 16);
  const H = rowStart + p.milestones.length * ROW_H + 8;
  const months = cal.months;
  const axisStart = dateMs(`${months[0] ?? cal.todayYm}-01`);
  const axisEnd = dateMs(`${nextMonth(months.at(-1) ?? cal.todayYm)}-01`);
  const xDate = (date: string): number => {
    const at = Math.min(axisEnd, Math.max(axisStart, dateMs(date)));
    return X0 + ((at - axisStart) / Math.max(1, axisEnd - axisStart)) * (X1 - X0);
  };
  const positions = new Map(p.milestones.map((m, index) => {
    const scheduled = Boolean(m.plannedStart && m.plannedEnd);
    const y = rowStart + index * ROW_H + ROW_H / 2;
    return [m.id, { start: xDate(scheduled ? m.plannedStart! : targetDate(m)), end: xDate(targetDate(m)), y }] as const;
  }));
  const activate = (action: () => void) => (event: React.KeyboardEvent<SVGGElement>) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); action(); }
  };
  const selectedMilestone = selection?.kind === "milestone" ? p.milestones.find((m) => m.id === selection.id) : null;
  const selectedRelease = selection?.kind === "release" ? releases.find((r) => r.id === selection.id) : releases.find((r) => r.id === picked);
  const selectedReleaseState = selectedRelease ? states[releases.indexOf(selectedRelease)] : null;
  const detail = selectedMilestone
    ? `${selectedMilestone.name} · ${STATUS_LABEL[selectedMilestone.status]} · ${selectedMilestone.plannedStart && selectedMilestone.plannedEnd ? `${shortDate(selectedMilestone.plannedStart)}–${shortDate(selectedMilestone.plannedEnd)}` : `target ${monthLabel(selectedMilestone.month, cal.todayYm)}`} · ${tierLabel(selectedMilestone)} · ${selectedMilestone.dependsOn?.length ? `depends on ${selectedMilestone.dependsOn.join(", ")}` : "no dependencies"}`
    : selectedRelease && selectedReleaseState
      ? `${selectedRelease.name} · target ${monthLabel(selectedRelease.month, cal.todayYm)} · ${selectedReleaseState.label} · ${selectedReleaseState.met}/${selectedReleaseState.total} criteria met`
      : "Select a milestone or release for schedule details.";
  const todayX = xDate(cal.asOf.slice(0, 10));

  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <svg aria-label="Project roadmap with planned durations and dependencies" viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", minWidth: 860, display: "block" }}>
          <defs><marker id="roadmap-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill={C.dim} /></marker></defs>

          <rect x={todayX} y={TOP - 6} width={Math.max(0, X1 - todayX)} height={H - TOP - 2} fill={C.accentSoft} opacity="0.07" />
          {months.map((month) => {
            const x = xDate(`${month}-01`);
            return <g key={month}><line x1={x} x2={x} y1={TOP - 6} y2={H - 4} stroke={C.line} strokeWidth="0.8" /><text x={x + 4} y={16} fontSize="10" fill={month === cal.todayYm ? C.text : C.dim}>{monthLabel(month, cal.todayYm)}</text></g>;
          })}
          <rect x="0" y={TOP - 6} width={LABEL_W} height={H - TOP + 2} fill={C.panel} opacity="0.96" />
          <line x1={LABEL_W} x2={LABEL_W} y1={TOP - 6} y2={H - 4} stroke={C.line2} />
          <line x1={todayX} x2={todayX} y1={TOP - 6} y2={H - 4} stroke={C.indigoHi} strokeWidth="1.2" strokeDasharray="3 4" />
          <text x={todayX + 5} y={TOP + 4} fontSize="9" fill={C.indigoHi}>Today</text>

          {releases.length > 0 && <>
            <text x="10" y={releaseY + 4} fontSize="9.5" fontWeight="600" letterSpacing="0.08em" fill={C.dim}>RELEASES</text>
            <line x1={X0} x2={X1} y1={releaseY} y2={releaseY} stroke={C.line2} />
            {releases.map((r, index) => {
              const state = states[index], x = xDate(`${r.month}-15`), color = state ? releaseToneColor(state.tone) : C.dim;
              const selected = selection?.kind === "release" ? selection.id === r.id : picked === r.id;
              const onRight = x > X1 - 100;
              const choose = () => { setSelection({ kind: "release", id: r.id }); onPick(r.id); };
              return <g key={r.id} role="button" tabIndex={0} aria-label={`Select release ${r.id}`} onClick={choose} onKeyDown={activate(choose)} style={{ cursor: "pointer" }}>
                <title>{`${r.id} · ${r.name} · ${state?.label ?? "Not configured"} · ${monthLabel(r.month, cal.todayYm)}`}</title>
                <rect x={x - 6} y={releaseY - 6} width="12" height="12" transform={`rotate(45 ${x} ${releaseY})`} fill={color} stroke={selected ? C.text : C.panel} strokeWidth={selected ? "2" : "1.5"} rx="1.5" />
                <text x={onRight ? x - 13 : x + 13} y={releaseY + 4} textAnchor={onRight ? "end" : "start"} fontSize="10.5" fontWeight={selected ? 650 : 500} fill={selected ? C.text : C.mut}>{r.id}</text>
              </g>;
            })}
            <line x1="0" x2={X1} y1={rowStart - 8} y2={rowStart - 8} stroke={C.line} />
          </>}

          {p.milestones.flatMap((m) => (m.dependsOn ?? []).map((dependency) => {
            const from = positions.get(dependency), to = positions.get(m.id);
            if (!from || !to) return null;
            const direction = to.start >= from.end ? 1 : -1;
            return <path key={`${m.id}:${dependency}`} d={`M${from.end} ${from.y} C${from.end + 28 * direction} ${from.y},${to.start - 28 * direction} ${to.y},${to.start} ${to.y}`} fill="none" stroke={C.line3} strokeWidth="1.2" opacity="0.7" markerEnd="url(#roadmap-arrow)" />;
          }))}

          {p.milestones.map((m, index) => {
            const pos = positions.get(m.id)!;
            const y = rowStart + index * ROW_H, scheduled = Boolean(m.plannedStart && m.plannedEnd), color = STATUS_COLOR[m.status];
            const selected = selection?.kind === "milestone" && selection.id === m.id;
            const linked = releases.filter((r) => r.milestoneIds.includes(m.id)).map((r) => r.id);
            const choose = () => setSelection({ kind: "milestone", id: m.id });
            return <g key={m.id} role="button" tabIndex={0} aria-label={`Inspect ${m.name}`} onClick={choose} onKeyDown={activate(choose)} style={{ cursor: "pointer" }}>
              <title>{`${m.id} · ${m.name} · ${STATUS_LABEL[m.status]} · ${tierLabel(m)}${linked.length ? ` · ${linked.join(", ")}` : ""}`}</title>
              {selected && <rect x="1" y={y + 2} width={X1 - 1} height={ROW_H - 4} rx="5" fill={C.accentSoft} opacity="0.16" />}
              <line x1="0" x2={X1} y1={y + ROW_H} y2={y + ROW_H} stroke={C.line} />
              <circle cx="11" cy={y + 20} r="3.5" fill={color} />
              <text x="22" y={y + 23} fontSize="11.5" fontWeight={selected ? 650 : 500} fill={selected ? C.text : C.mut}>{truncate(m.name, 31)}</text>
              <text x="22" y={y + 41} fontSize="9.5" fill={C.dim}>{m.id} · <tspan fill={color}>{STATUS_LABEL[m.status]}</tspan>{linked.length ? ` · ${linked.join(", ")}` : ""}</text>
              <line x1={X0} x2={X1} y1={pos.y} y2={pos.y} stroke={C.line} />
              {scheduled
                ? <rect x={pos.start} y={pos.y - 9} width={Math.max(10, pos.end - pos.start)} height="18" rx="4" fill={m.status === "shipped" ? C.goodSoft : m.status === "backlog" ? C.field : C.accentSoft} stroke={selected ? C.text : color} strokeWidth={selected ? "1.7" : "1.1"} />
                : <line x1={pos.end - 20} x2={pos.end + 20} y1={pos.y} y2={pos.y} stroke={C.line3} strokeWidth="2" strokeLinecap="round" strokeDasharray="2 4" />}
              <rect x={pos.end - 5} y={pos.y - 5} width="10" height="10" transform={`rotate(45 ${pos.end} ${pos.y})`} fill={C.panel} stroke={gateDotColor(m)} strokeWidth="2" rx="1" />
            </g>;
          })}
        </svg>
      </div>
      <div aria-live="polite" style={{ minHeight: 36, borderTop: `1px solid ${C.line}`, padding: "8px 10px", display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: C.dim }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: selection?.kind === "release" ? (selectedReleaseState ? releaseToneColor(selectedReleaseState.tone) : C.dim) : selectedMilestone ? gateDotColor(selectedMilestone) : C.indigoHi, flexShrink: 0 }} />{detail}
      </div>
    </div>
  );
}
