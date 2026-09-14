import { isMeasurable, monthIndex, monthLabel, STATUS_LABEL, tierOf } from "@valueflow/domain";
import type { Calendar, Project, Release, ReleaseState } from "@valueflow/domain";
import { C, STATUS_COLOR, releaseToneColor } from "../theme.ts";

function Diamond({ x, y, size = 6.5, color }: { x: number; y: number; size?: number; color: string }) {
  return <rect x={x - size} y={y - size} width={size * 2} height={size * 2} transform={`rotate(45 ${x} ${y})`} fill={color} stroke={C.bg} strokeWidth="1.5" rx="1.5" />;
}

export const gateDotColor = (m: Project["milestones"][number]): string => {
  const t = tierOf(m);
  switch (t) {
    case 2:
      return C.green;
    case 1:
      return C.indigo;
    case 0:
      return isMeasurable(m) ? C.amber : C.dim;
  }
};

export function RoadmapTimeline({
  p,
  releases,
  states,
  onPick,
  picked,
  cal,
}: {
  p: Project;
  releases: Release[];
  states: ReleaseState[];
  onPick: (id: string) => void;
  picked: string | null;
  cal: Calendar;
}) {
  const rows = p.milestones;
  const MONTHS = cal.months;
  const TODAY = cal.today;
  const LBL = 216;
  const W = 980;
  const RH = 36;
  const PT = 42;
  const PB = 28;
  const H = PT + RH * (rows.length + 1) + PB;
  const x0 = LBL + 8;
  const iw = W - x0 - 12;
  const X = (i: number) => x0 + (i / Math.max(1, MONTHS.length - 1)) * iw;
  const XM = (ym: string) => X(monthIndex(cal, ym));
  const trunc = (s: string, n = 20) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

  return (
    <div style={{ overflowX: "auto" }}>
    <svg aria-label="Project roadmap by target month" viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", minWidth: 780, display: "block" }}>
      <defs>
        <pattern id="rmH" width="7" height="7" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
          <line x1="0" y1="0" x2="0" y2="7" stroke={C.line2} strokeWidth="1.3" />
        </pattern>
      </defs>
      <rect x={X(TODAY)} y={PT - 18} width={Math.max(0, X(MONTHS.length - 1) - X(TODAY))} height={H - PT - PB + 18} fill="url(#rmH)" opacity="0.45" />
      {MONTHS.map((mo, i) => (
        <g key={mo}>
          <line x1={X(i)} x2={X(i)} y1={PT - 18} y2={H - PB} stroke={i === TODAY ? C.line3 : C.line} strokeWidth={i === TODAY ? "1.2" : "0.7"} />
          <text x={X(i)} y={18} fontSize="10" fill={i === TODAY ? C.text : C.dim} textAnchor="middle" fontWeight={i === TODAY ? 600 : 400}>
            {monthLabel(mo, cal.todayYm)}
          </text>
        </g>
      ))}
      <line x1={X(TODAY)} x2={X(TODAY)} y1={PT - 12} y2={H - PB} stroke={C.line3} strokeWidth="1.2" />
      <text x={X(TODAY) + 5} y={PT - 5} fontSize="9" fill={C.indigoHi}>Today</text>

      <text x={4} y={PT + RH / 2 + 3} fontSize="11" fill={C.mut} fontWeight="600">Releases</text>
      <line x1={x0} x2={W - 12} y1={PT + RH - 4} y2={PT + RH - 4} stroke={C.line} />
      {releases.map((r, i) => {
        const st = states[i];
        const color = st ? releaseToneColor(st.tone) : C.dim;
        return (
          <g key={r.id} style={{ cursor: "pointer" }} role="button" tabIndex={0} aria-label={`Select release ${r.id}`} onClick={() => onPick(r.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(r.id); } }}>
            <Diamond x={XM(r.month)} y={PT + RH / 2 - 3} color={color} />
            <title>{`${r.id} · ${r.name} · target ${monthLabel(r.month, cal.todayYm)} · ${st?.label ?? ""}`}</title>
            <text x={XM(r.month)} y={PT + RH / 2 - 14} fontSize="9.5" fill={picked === r.id ? C.text : C.mut} textAnchor="middle" fontWeight={picked === r.id ? 600 : 400}>
              {r.id}
            </text>
          </g>
        );
      })}

      {rows.map((m, i) => {
        const y = PT + RH * (i + 1) + 6;
        const linked = releases.find((r) => r.milestoneIds.includes(m.id));
        return (
          <g key={m.id}>
            <text x={4} y={y + 10} fontSize="11" fill={C.text}>
              <title>{m.name}</title>
              {trunc(m.name, 28)}
            </text>
            <text x={4} y={y + 24} fontSize="9.5" fill={STATUS_COLOR[m.status]}>{STATUS_LABEL[m.status]}</text>
            <line x1={XM(m.month)} x2={XM(m.month)} y1={y - 1} y2={y + 17} stroke={STATUS_COLOR[m.status]} strokeWidth="1.4" opacity="0.8" />
            <circle cx={XM(m.month)} cy={y + 7} r="4.5" fill={gateDotColor(m)} stroke={C.bg} strokeWidth="1.5" />
            {linked && <line x1={XM(m.month)} x2={XM(linked.month)} y1={y + 7} y2={PT + RH / 2 + 4} stroke={C.line2} strokeWidth="1" strokeDasharray="2 3" />}
          </g>
        );
      })}
    </svg>
    </div>
  );
}
