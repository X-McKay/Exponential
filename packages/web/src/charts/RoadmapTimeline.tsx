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
  const W = 980, X0 = 40, X1 = W - 24, PT = 42, RH = 68;
  const H = PT + p.milestones.length * RH + (releases.length ? 68 : 0) + 26;
  const months = cal.months;
  const axisStart = dateMs(`${months[0] ?? cal.todayYm}-01`);
  const axisEnd = dateMs(`${nextMonth(months.at(-1) ?? cal.todayYm)}-01`);
  const xDate = (date: string): number => {
    const at = Math.min(axisEnd, Math.max(axisStart, dateMs(date)));
    return X0 + ((at - axisStart) / Math.max(1, axisEnd - axisStart)) * (X1 - X0);
  };
  const rowY = (index: number): number => PT + index * RH;
  const positions = new Map(p.milestones.map((m, index) => {
    const scheduled = Boolean(m.plannedStart && m.plannedEnd);
    return [m.id, { start: xDate(scheduled ? m.plannedStart! : targetDate(m)), end: xDate(scheduled ? m.plannedEnd! : targetDate(m)), y: rowY(index) + 38 }] as const;
  }));

  const activate = (action: () => void) => (event: React.KeyboardEvent<SVGGElement>) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); action(); }
  };
  const selectedMilestone = selection?.kind === "milestone" ? p.milestones.find((m) => m.id === selection.id) : null;
  const selectedRelease = selection?.kind === "release" ? releases.find((r) => r.id === selection.id) : releases.find((r) => r.id === picked);
  const selectedReleaseState = selectedRelease ? states[releases.indexOf(selectedRelease)] : null;
  const detail = selectedMilestone
    ? `${STATUS_LABEL[selectedMilestone.status]} · ${selectedMilestone.plannedStart && selectedMilestone.plannedEnd ? `${shortDate(selectedMilestone.plannedStart)}–${shortDate(selectedMilestone.plannedEnd)}` : `target ${monthLabel(selectedMilestone.month, cal.todayYm)}`} · ${tierLabel(selectedMilestone)} · ${selectedMilestone.dependsOn?.length ? `depends on ${selectedMilestone.dependsOn.join(", ")}` : "no dependencies"}`
    : selectedRelease && selectedReleaseState
      ? `${selectedRelease.name} · target ${monthLabel(selectedRelease.month, cal.todayYm)} · ${selectedReleaseState.label} · ${selectedReleaseState.met}/${selectedReleaseState.total} criteria met`
      : "Select a milestone or release for schedule details.";

  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <svg aria-label="Project roadmap with planned durations and dependencies" viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", minWidth: 800, display: "block" }}>
          <defs><marker id="roadmap-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z" fill={C.dim} /></marker></defs>
          <rect x={xDate(cal.asOf.slice(0, 10))} y={PT - 12} width={Math.max(0, X1 - xDate(cal.asOf.slice(0, 10)))} height={H - PT - 4} fill={C.accentSoft} opacity="0.1" />
          {months.map((month) => {
            const x = xDate(`${month}-01`);
            return <g key={month}><line x1={x} x2={x} y1={PT - 12} y2={H - 12} stroke={C.line} strokeWidth="0.8" /><text x={x + 5} y={17} fontSize="10" fill={month === cal.todayYm ? C.text : C.dim}>{monthLabel(month, cal.todayYm)}</text></g>;
          })}
          <line x1={xDate(cal.asOf.slice(0, 10))} x2={xDate(cal.asOf.slice(0, 10))} y1={PT - 12} y2={H - 12} stroke={C.indigoHi} strokeWidth="1.2" strokeDasharray="3 3" />
          <text x={xDate(cal.asOf.slice(0, 10)) + 5} y={PT - 2} fontSize="9" fill={C.indigoHi}>Today</text>

          {p.milestones.flatMap((m) => (m.dependsOn ?? []).map((dependency) => {
            const from = positions.get(dependency), to = positions.get(m.id);
            if (!from || !to) return null;
            const bend = Math.max(18, Math.abs(to.start - from.end) * 0.45);
            return <path key={`${m.id}:${dependency}`} d={`M${from.end} ${from.y + 10} C${from.end} ${from.y + 28},${to.start - bend} ${to.y - 28},${to.start} ${to.y - 10}`} fill="none" stroke={C.line3} strokeWidth="1.3" markerEnd="url(#roadmap-arrow)" />;
          }))}

          {p.milestones.map((m, index) => {
            const pos = positions.get(m.id)!;
            const y = rowY(index), scheduled = Boolean(m.plannedStart && m.plannedEnd), color = STATUS_COLOR[m.status];
            const labelX = Math.max(X0 + 4, Math.min(pos.start, X1 - 235));
            const selected = selection?.kind === "milestone" && selection.id === m.id;
            const release = releases.find((r) => r.milestoneIds.includes(m.id));
            const choose = () => setSelection({ kind: "milestone", id: m.id });
            return (
              <g key={m.id} role="button" tabIndex={0} aria-label={`Inspect ${m.name}`} onClick={choose} onKeyDown={activate(choose)} style={{ cursor: "pointer" }}>
                <title>{`${m.id} · ${m.name} · ${STATUS_LABEL[m.status]} · ${tierLabel(m)}${release ? ` · ${release.id}` : ""}`}</title>
                <text x={labelX} y={y + 14} fontSize="11.5" fill={selected ? C.text : C.mut} fontWeight={selected ? 600 : 500}>{m.name}</text>
                <text x={labelX} y={y + 27} fontSize="9.5" fill={C.dim}>{m.id} · {STATUS_LABEL[m.status]}{release ? ` · ${release.id}` : ""}</text>
                {scheduled
                  ? <rect x={pos.start} y={y + 33} width={Math.max(8, pos.end - pos.start)} height="20" rx="4" fill={m.status === "shipped" ? C.goodSoft : m.status === "backlog" ? C.field : C.accentSoft} stroke={selected ? C.text : color} strokeWidth={selected ? "1.7" : "1"} />
                  : <line x1={pos.end - 22} x2={pos.end + 22} y1={y + 43} y2={y + 43} stroke={C.line2} strokeWidth="2" strokeLinecap="round" strokeDasharray="2 4" />}
                <rect x={pos.end - 5} y={y + 38} width="10" height="10" transform={`rotate(45 ${pos.end} ${y + 43})`} fill={C.panel} stroke={gateDotColor(m)} strokeWidth="2" rx="1" />
              </g>
            );
          })}

          {releases.length > 0 && <line x1={X0} x2={X1} y1={PT + p.milestones.length * RH + 2} y2={PT + p.milestones.length * RH + 2} stroke={C.line} />}
          {releases.map((r, index) => {
            const state = states[index], x = xDate(`${r.month}-15`), y = PT + p.milestones.length * RH + 36;
            const color = state ? releaseToneColor(state.tone) : C.dim;
            const selected = selection?.kind === "release" ? selection.id === r.id : picked === r.id;
            const choose = () => { setSelection({ kind: "release", id: r.id }); onPick(r.id); };
            return (
              <g key={r.id} role="button" tabIndex={0} aria-label={`Select release ${r.id}`} onClick={choose} onKeyDown={activate(choose)} style={{ cursor: "pointer" }}>
                {r.milestoneIds.map((mid) => { const from = positions.get(mid); return from ? <path key={mid} d={`M${from.end} ${from.y + 10} C${from.end + 22} ${from.y + 24},${x - 30} ${y - 20},${x} ${y - 8}`} fill="none" stroke={color} strokeWidth="1.1" opacity="0.55" /> : null; })}
                <rect x={x - 7} y={y - 7} width="14" height="14" transform={`rotate(45 ${x} ${y})`} fill={color} stroke={C.panel} strokeWidth="2" rx="1.5" />
                <text x={Math.min(x + 16, X1 - 145)} y={y - 2} fontSize="11" fill={selected ? C.text : C.mut} fontWeight={selected ? 600 : 500}>{r.id} · {r.name}</text>
                <text x={Math.min(x + 16, X1 - 145)} y={y + 12} fontSize="9.5" fill={C.dim}>{state?.label ?? "Not configured"} · {monthLabel(r.month, cal.todayYm)}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <div aria-live="polite" style={{ minHeight: 36, borderTop: `1px solid ${C.line}`, padding: "8px 10px", display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: C.dim }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: selection?.kind === "release" ? (selectedReleaseState ? releaseToneColor(selectedReleaseState.tone) : C.dim) : selectedMilestone ? gateDotColor(selectedMilestone) : C.indigoHi, flexShrink: 0 }} />{detail}
      </div>
    </div>
  );
}
