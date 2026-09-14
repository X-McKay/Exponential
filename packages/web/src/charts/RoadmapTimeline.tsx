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

export type RoadmapReleaseRow = { release: Release; milestones: Milestone[]; start: string; end: string };

export const roadmapReleaseRows = (project: Pick<Project, "milestones">, releases: Release[]): {
  rows: RoadmapReleaseRow[];
  unassigned: Milestone[];
} => {
  const byId = new Map(project.milestones.map((milestone) => [milestone.id, milestone]));
  const assigned = new Set(releases.flatMap((release) => release.milestoneIds));
  return {
    rows: releases.map((release) => {
      const milestones = release.milestoneIds.flatMap((id) => {
        const milestone = byId.get(id);
        return milestone ? [milestone] : [];
      });
      const starts = milestones.map((milestone) => milestone.plannedStart ?? targetDate(milestone)).sort();
      return { release, milestones, start: starts[0] ?? `${release.month}-01`, end: `${release.month}-15` };
    }),
    unassigned: project.milestones.filter((milestone) => !assigned.has(milestone.id)),
  };
};

export function RoadmapTimeline({ p, releases, states, onPick, picked, cal }: {
  p: Project;
  releases: Release[];
  states: ReleaseState[];
  onPick: (id: string) => void;
  picked: string | null;
  cal: Calendar;
}) {
  const [selection, setSelection] = useState<Selection>(null);
  const { rows, unassigned } = roadmapReleaseRows(p, releases);
  const W = 1120, LABEL_W = 252, X0 = LABEL_W + 18, X1 = W - 24, TOP = 34, ROW_H = 72;
  const rowStart = TOP + 12, unassignedY = rowStart + rows.length * ROW_H + 29;
  const H = rowStart + rows.length * ROW_H + (unassigned.length ? 60 : 0) + 8;
  const months = cal.months;
  const axisStart = dateMs(`${months[0] ?? cal.todayYm}-01`);
  const axisEnd = dateMs(`${nextMonth(months.at(-1) ?? cal.todayYm)}-01`);
  const xDate = (date: string): number => {
    const at = Math.min(axisEnd, Math.max(axisStart, dateMs(date)));
    return X0 + ((at - axisStart) / Math.max(1, axisEnd - axisStart)) * (X1 - X0);
  };
  const positions = new Map<string, { x: number; y: number }>();
  rows.forEach((row, index) => row.milestones.forEach((milestone) => positions.set(milestone.id, { x: xDate(targetDate(milestone)), y: rowStart + index * ROW_H + 31 })));
  unassigned.forEach((milestone) => positions.set(milestone.id, { x: xDate(targetDate(milestone)), y: unassignedY }));
  const activate = (action: () => void) => (event: React.KeyboardEvent<SVGGElement>) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); action(); }
  };
  const selectedMilestone = selection?.kind === "milestone" ? p.milestones.find((m) => m.id === selection.id) : null;
  const selectedRelease = selection?.kind === "release" ? releases.find((r) => r.id === selection.id) : releases.find((r) => r.id === picked);
  const selectedReleaseState = selectedRelease ? states[releases.indexOf(selectedRelease)] : null;
  const detail = selectedMilestone
    ? `${selectedMilestone.name} · ${STATUS_LABEL[selectedMilestone.status]} · ${selectedMilestone.plannedStart && selectedMilestone.plannedEnd ? `${shortDate(selectedMilestone.plannedStart)}–${shortDate(selectedMilestone.plannedEnd)}` : `target ${monthLabel(selectedMilestone.month, cal.todayYm)}`} · ${tierLabel(selectedMilestone)} · ${selectedMilestone.dependsOn?.length ? `depends on ${selectedMilestone.dependsOn.join(", ")}` : "no dependencies"}`
    : selectedRelease && selectedReleaseState
      ? `${selectedRelease.name} · target ${monthLabel(selectedRelease.month, cal.todayYm)} · ${selectedReleaseState.label} · ${selectedReleaseState.met}/${selectedReleaseState.total} criteria met · ${selectedRelease.milestoneIds.length} milestone${selectedRelease.milestoneIds.length === 1 ? "" : "s"}`
      : "Select a release bar or milestone checkpoint for schedule details.";
  const todayX = xDate(cal.asOf.slice(0, 10));

  return <div>
    <div style={{ overflowX: "auto" }}>
      <svg aria-label="Project releases with milestone checkpoints and dependencies" viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", minWidth: 860, display: "block" }}>
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

        {p.milestones.flatMap((milestone) => (milestone.dependsOn ?? []).map((dependency) => {
          const from = positions.get(dependency), to = positions.get(milestone.id);
          if (!from || !to) return null;
          if (from.y === to.y) {
            const arch = Math.min(18, Math.abs(to.x - from.x) / 3);
            return <path key={`${milestone.id}:${dependency}`} d={`M${from.x + 6} ${from.y} C${from.x + 16} ${from.y - arch},${to.x - 16} ${to.y - arch},${to.x - 6} ${to.y}`} fill="none" stroke={C.line3} strokeWidth="1.1" opacity="0.75" markerEnd="url(#roadmap-arrow)" />;
          }
          return <path key={`${milestone.id}:${dependency}`} d={`M${from.x} ${from.y + 6} C${from.x} ${from.y + 24},${to.x - 10} ${to.y - 24},${to.x - 6} ${to.y}`} fill="none" stroke={C.line3} strokeWidth="1.1" opacity="0.7" markerEnd="url(#roadmap-arrow)" />;
        }))}

        {rows.map((row, index) => {
          const { release, milestones } = row;
          const state = states[releases.indexOf(release)], color = state ? releaseToneColor(state.tone) : C.dim;
          const y = rowStart + index * ROW_H, barY = y + 31, start = xDate(row.start), end = xDate(row.end);
          const selected = selection?.kind === "release" ? selection.id === release.id : picked === release.id;
          const containsSelection = selection?.kind === "milestone" && release.milestoneIds.includes(selection.id);
          const choose = () => { setSelection({ kind: "release", id: release.id }); onPick(release.id); };
          return <g key={release.id}>
            {(selected || containsSelection) && <rect x="1" y={y + 2} width={X1 - 1} height={ROW_H - 4} rx="5" fill={C.accentSoft} opacity="0.16" />}
            <line x1="0" x2={X1} y1={y + ROW_H} y2={y + ROW_H} stroke={C.line} />
            <g role="button" tabIndex={0} aria-label={`Select release ${release.name}`} onClick={choose} onKeyDown={activate(choose)} style={{ cursor: "pointer" }}>
              <title>{`${release.id} · ${release.name} · ${state?.label ?? "Not configured"} · ${monthLabel(release.month, cal.todayYm)}`}</title>
              <rect x="9" y={y + 16} width="9" height="9" transform={`rotate(45 13.5 ${y + 20.5})`} fill={color} rx="1.5" />
              <text x="27" y={y + 23} fontSize="12" fontWeight={selected ? 650 : 550} fill={selected ? C.text : C.mut}>{truncate(release.name, 28)}</text>
              <text x="27" y={y + 41} fontSize="9.5" fill={C.dim}>{release.id} · <tspan fill={color}>{state?.label ?? "Not configured"}</tspan> · {monthLabel(release.month, cal.todayYm)}</text>
              <text x="27" y={y + 57} fontSize="9" fill={C.dim}>{milestones.length ? truncate(milestones.map((milestone) => milestone.name).join(" · "), 39) : "No milestones assigned"}</text>
              <line x1={X0} x2={X1} y1={barY} y2={barY} stroke={C.line} />
              <rect x={Math.min(start, end - 12)} y={barY - 9} width={Math.max(12, end - start)} height="18" rx="4" fill={C.field} stroke={selected ? C.text : color} strokeWidth={selected ? "1.7" : "1.2"} />
              <rect x={end - 5.5} y={barY - 5.5} width="11" height="11" transform={`rotate(45 ${end} ${barY})`} fill={color} stroke={selected ? C.text : C.panel} strokeWidth="1.5" rx="1.5" />
              <text x={end > X1 - 72 ? end - 11 : end + 11} y={barY + 4} textAnchor={end > X1 - 72 ? "end" : "start"} fontSize="9.5" fontWeight="600" fill={C.mut}>{release.id}</text>
            </g>
            {milestones.map((milestone) => {
              const pos = positions.get(milestone.id)!;
              const milestoneSelected = selection?.kind === "milestone" && selection.id === milestone.id;
              const inspect = () => setSelection({ kind: "milestone", id: milestone.id });
              return <g key={milestone.id} role="button" tabIndex={0} aria-label={`Inspect milestone ${milestone.name}`} onClick={inspect} onKeyDown={activate(inspect)} style={{ cursor: "pointer" }}>
                <title>{`${milestone.id} · ${milestone.name} · ${STATUS_LABEL[milestone.status]} · ${tierLabel(milestone)}`}</title>
                <rect x={pos.x - 11} y={barY - 12} width="22" height="37" fill="transparent" />
                <rect x={pos.x - 4.5} y={barY - 4.5} width="9" height="9" transform={`rotate(45 ${pos.x} ${barY})`} fill={C.panel} stroke={milestoneSelected ? C.text : gateDotColor(milestone)} strokeWidth={milestoneSelected ? "2.2" : "1.7"} rx="1" />
                <text x={pos.x} y={barY + 22} textAnchor="middle" fontSize="8.5" fontWeight={milestoneSelected ? 650 : 500} fill={milestoneSelected ? C.text : C.dim}>{milestone.id}</text>
              </g>;
            })}
          </g>;
        })}

        {unassigned.length > 0 && <g>
          <line x1="0" x2={X1} y1={rowStart + rows.length * ROW_H} y2={rowStart + rows.length * ROW_H} stroke={C.line2} strokeDasharray="3 4" />
          <text x="10" y={unassignedY - 5} fontSize="10.5" fontWeight="550" fill={C.mut}>Unassigned milestones</text>
          <text x="10" y={unassignedY + 13} fontSize="9" fill={C.dim}>Targets outside a release</text>
          <line x1={X0} x2={X1} y1={unassignedY} y2={unassignedY} stroke={C.line} strokeDasharray="3 4" />
          {unassigned.map((milestone) => {
            const pos = positions.get(milestone.id)!;
            const selected = selection?.kind === "milestone" && selection.id === milestone.id;
            const inspect = () => setSelection({ kind: "milestone", id: milestone.id });
            return <g key={milestone.id} role="button" tabIndex={0} aria-label={`Inspect unassigned milestone ${milestone.name}`} onClick={inspect} onKeyDown={activate(inspect)} style={{ cursor: "pointer" }}>
              <title>{`${milestone.id} · ${milestone.name} · ${STATUS_LABEL[milestone.status]}`}</title>
              <rect x={pos.x - 11} y={pos.y - 12} width="45" height="24" fill="transparent" />
              <rect x={pos.x - 5} y={pos.y - 5} width="10" height="10" transform={`rotate(45 ${pos.x} ${pos.y})`} fill={C.panel} stroke={selected ? C.text : gateDotColor(milestone)} strokeWidth={selected ? "2.2" : "1.8"} rx="1" />
              <text x={pos.x + 10} y={pos.y + 4} fontSize="8.5" fill={selected ? C.text : STATUS_COLOR[milestone.status]}>{milestone.id}</text>
            </g>;
          })}
        </g>}
      </svg>
    </div>
    <div aria-live="polite" style={{ minHeight: 36, borderTop: `1px solid ${C.line}`, padding: "8px 10px", display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: C.dim }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: selection?.kind === "release" ? (selectedReleaseState ? releaseToneColor(selectedReleaseState.tone) : C.dim) : selectedMilestone ? gateDotColor(selectedMilestone) : C.indigoHi, flexShrink: 0 }} />{detail}
    </div>
  </div>;
}
