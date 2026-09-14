import { useMemo, useState } from "react";
import { burnupSeries, monthIndex, monthLabel } from "@valueflow/domain";
import type { Calendar, Dim, Milestone } from "@valueflow/domain";
import { C, STATUS_COLOR } from "../theme.ts";

export function Burnup({ milestones, historicalMilestones, dim, target, cal }: { milestones: Milestone[]; historicalMilestones?: Milestone[]; dim: Dim; target: number; cal: Calendar }) {
  const [hover, setHover] = useState<number | null>(null);
  const MONTHS = cal.months;
  const TODAY = cal.today;
  const XM = (ym: string) => X(monthIndex(cal, ym));
  const W = 720;
  const H = 240;
  const PL = 34;
  const PR = 14;
  const PT = 16;
  const PB = 26;
  const iw = W - PL - PR;
  const ih = H - PT - PB;
  const yMax = Math.max(target + 10, 50);
  const X = (i: number) => PL + (i / (MONTHS.length - 1)) * iw;
  const Y = (v: number) => PT + ih - (v / yMax) * ih;

  const S = useMemo(() => burnupSeries(milestones, dim, cal, historicalMilestones), [milestones, historicalMilestones, dim, cal]);

  const path = (arr: (number | null)[], stop = MONTHS.length - 1) =>
    arr
      .map((v, i) => (v === null || i > stop ? null : `${i === 0 || arr[i - 1] === null ? "M" : "L"}${X(i)},${Y(v)}`))
      .filter(Boolean)
      .join(" ");
  const rp = path(S.real, TODAY);
  const realToday = S.real[TODAY] ?? 0;
  const firstKnown = S.real.findIndex((v, i) => i <= TODAY && v !== null);

  return (
    <div style={{ position: "relative" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", display: "block" }}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const i = Math.round(((((e.clientX - r.left) / r.width) * W - PL) / iw) * (MONTHS.length - 1));
          setHover(Math.max(0, Math.min(MONTHS.length - 1, i)));
        }}
      >
        <defs>
          <linearGradient id="vfA" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C.indigo} stopOpacity="0.35" />
            <stop offset="100%" stopColor={C.indigo} stopOpacity="0.02" />
          </linearGradient>
          <pattern id="vfH" width="7" height="7" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <line x1="0" y1="0" x2="0" y2="7" stroke={C.line2} strokeWidth="1.4" />
          </pattern>
        </defs>
        <rect x={X(TODAY)} y={PT} width={X(MONTHS.length - 1) - X(TODAY)} height={ih} fill="url(#vfH)" opacity="0.5" />
        {[0, 10, 20, 30, 40, 50, 60]
          .filter((v) => v <= yMax)
          .map((v) => (
            <g key={v}>
              <line x1={PL} x2={W - PR} y1={Y(v)} y2={Y(v)} stroke={C.line} strokeDasharray="3 5" />
              <text x={PL - 8} y={Y(v) + 3.5} fontSize="10" fill={C.dim} textAnchor="end">
                {v}%
              </text>
            </g>
          ))}
        <line x1={PL} x2={W - PR} y1={Y(target)} y2={Y(target)} stroke={C.red} strokeWidth="1.2" strokeDasharray="6 4" opacity="0.8" />
        <text x={W - PR - 4} y={Y(target) - 5} fontSize="10" fill={C.red} textAnchor="end" opacity="0.9">
          target {target}%
        </text>
        <path d={path(S.ceil)} fill="none" stroke={C.dim} strokeWidth="1.3" strokeDasharray="2 4" />
        <path d={path(S.com)} fill="none" stroke={C.indigoHi} strokeWidth="1.6" strokeDasharray="6 5" opacity="0.85" />
        {rp && firstKnown >= 0 && <path d={`${rp} L${X(TODAY)},${Y(0)} L${X(firstKnown)},${Y(0)} Z`} fill="url(#vfA)" />}
        <path d={rp} fill="none" stroke={C.indigo} strokeWidth="2.2" strokeLinejoin="round" pathLength="1" className="vf-draw" />
        <circle cx={X(TODAY)} cy={Y(realToday)} r="4" fill={C.indigoHi} stroke={C.bg} strokeWidth="2" />
        {milestones.map((m) => (
          <g key={m.id} opacity={m.month <= cal.todayYm ? 1 : 0.65}>
            <line x1={XM(m.month)} x2={XM(m.month)} y1={PT + ih - 6} y2={PT + ih} stroke={STATUS_COLOR[m.status]} strokeWidth="2" />
            <circle cx={XM(m.month)} cy={PT + ih + 8} r="2.6" fill={STATUS_COLOR[m.status]} />
          </g>
        ))}
        <line x1={X(TODAY)} x2={X(TODAY)} y1={PT} y2={PT + ih} stroke={C.line3} strokeWidth="1" />
        {MONTHS.map((mo, i) =>
          i % 2 === 0 ? (
            <text key={mo} x={X(i)} y={H - 8} fontSize="9.5" fill={i === TODAY ? C.mut : C.dim} textAnchor="middle">
              {monthLabel(mo, cal.todayYm)}
            </text>
          ) : null,
        )}
        {hover !== null && <line x1={X(hover)} x2={X(hover)} y1={PT} y2={PT + ih} stroke={C.line2} strokeWidth="1" />}
      </svg>
      {hover !== null && (
        <div
          style={{
            position: "absolute",
            top: 8,
            left: `min(max(${(X(hover) / W) * 100}%, 12%), 70%)`,
            transform: "translateX(-50%)",
            background: C.raised,
            border: `1px solid ${C.line2}`,
            borderRadius: 8,
            padding: "8px 11px",
            pointerEvents: "none",
            boxShadow: `0 8px 24px ${C.shadow2}`,
            zIndex: 5,
          }}
        >
          <div style={{ fontSize: 11, color: C.mut, marginBottom: 4 }}>{monthLabel(MONTHS[hover] ?? cal.todayYm, cal.todayYm)}</div>
          <div style={{ fontSize: 12, color: C.indigoHi }}>{S.real[Math.min(hover, TODAY)] === null ? "eligible unknown" : `eligible ${S.real[Math.min(hover, TODAY)]}%`}</div>
          {S.com[hover] !== null && <div style={{ fontSize: 12, color: C.mut }}>committed {S.com[hover]}%</div>}
          <div style={{ fontSize: 12, color: C.dim }}>ceiling {S.ceil[hover]}%</div>
        </div>
      )}
    </div>
  );
}
