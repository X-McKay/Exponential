import { MONTHS, TODAY, isMeasurable, tierOf } from "@valueflow/domain";
import type { Project, Release, ReleaseState } from "@valueflow/domain";
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
}: {
  p: Project;
  releases: Release[];
  states: ReleaseState[];
  onPick: (id: string) => void;
  picked: string | null;
}) {
  const rows = p.milestones;
  const LBL = 148;
  const W = 740;
  const RH = 30;
  const PT = 34;
  const PB = 24;
  const H = PT + RH * (rows.length + 1) + PB;
  const x0 = LBL + 8;
  const iw = W - x0 - 12;
  const X = (i: number) => x0 + (i / (MONTHS.length - 1)) * iw;
  const trunc = (s: string, n = 20) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }}>
      <defs>
        <pattern id="rmH" width="7" height="7" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
          <line x1="0" y1="0" x2="0" y2="7" stroke="#242836" strokeWidth="1.3" />
        </pattern>
      </defs>
      <rect x={X(TODAY)} y={PT - 12} width={X(MONTHS.length - 1) - X(TODAY)} height={H - PT - PB + 12} fill="url(#rmH)" opacity="0.45" />
      {MONTHS.map((mo, i) =>
        i % 2 === 0 ? (
          <g key={mo}>
            <line x1={X(i)} x2={X(i)} y1={PT - 12} y2={H - PB} stroke={C.line} strokeWidth="0.7" />
            <text x={X(i)} y={16} fontSize="9.5" fill={i === TODAY ? C.mut : C.dim} textAnchor="middle">
              {mo}
            </text>
          </g>
        ) : null,
      )}
      <line x1={X(TODAY)} x2={X(TODAY)} y1={PT - 12} y2={H - PB} stroke="#3B4152" strokeWidth="1.2" />

      <text x={4} y={PT + RH / 2 + 3} fontSize="11" fill={C.mut}>
        Releases
      </text>
      <line x1={x0} x2={W - 12} y1={PT + RH - 4} y2={PT + RH - 4} stroke={C.line} />
      {releases.map((r, i) => {
        const st = states[i];
        const color = st ? releaseToneColor(st.tone) : C.dim;
        return (
          <g key={r.id} style={{ cursor: "pointer" }} onClick={() => onPick(r.id)}>
            <Diamond x={X(r.month)} y={PT + RH / 2 - 3} color={color} />
            <text x={X(r.month)} y={PT + RH / 2 - 14} fontSize="9.5" fill={picked === r.id ? C.text : C.mut} textAnchor="middle" fontWeight={picked === r.id ? 600 : 400}>
              {r.id}
            </text>
          </g>
        );
      })}

      {rows.map((m, i) => {
        const y = PT + RH * (i + 1) + 6;
        const start = Math.max(0, m.month - 3);
        const linked = releases.find((r) => r.milestoneIds.includes(m.id));
        return (
          <g key={m.id}>
            <text x={4} y={y + 10} fontSize="10.5" fill={C.mut}>
              <title>{m.name}</title>
              {trunc(m.name)}
            </text>
            <rect
              x={X(start)}
              y={y}
              width={Math.max(8, X(m.month) - X(start))}
              height={14}
              rx="4"
              fill={STATUS_COLOR[m.status]}
              opacity={m.status === "shipped" ? 0.85 : 0.3}
              stroke={STATUS_COLOR[m.status]}
              strokeWidth="1"
            />
            <circle cx={X(m.month)} cy={y + 7} r="4.5" fill={gateDotColor(m)} stroke={C.bg} strokeWidth="1.5" />
            {linked && <line x1={X(m.month)} x2={X(linked.month)} y1={y + 7} y2={PT + RH / 2 + 4} stroke={C.line2} strokeWidth="1" strokeDasharray="2 3" />}
          </g>
        );
      })}
    </svg>
  );
}
