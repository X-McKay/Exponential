// Small charts: sparkline, bullet gauge, governance stack, commit bars, people bars.

import { useMemo } from "react";
import { GSTATUS_LABEL, MONTHS, TODAY, burnupSeries, metricLevel } from "@valueflow/domain";
import type { Contributor, Dim, GovStatus, Metric, Milestone, Project } from "@valueflow/domain";
import { Avatar } from "../ui/primitives.tsx";
import { C, GSTATUS_COLOR } from "../theme.ts";

export function Spark({ milestones, dim, target }: { milestones: Milestone[]; dim: Dim; target: number }) {
  const W = 220;
  const H = 56;
  const P = 4;
  const iw = W - P * 2;
  const ih = H - P * 2 - 10;
  const X = (i: number) => P + (i / (MONTHS.length - 1)) * iw;
  const real = burnupSeries(milestones, dim).real;
  const yMax = Math.max(target, ...real, 1);
  const Y = (v: number) => P + ih - (v / yMax) * ih;
  const d = real
    .slice(0, TODAY + 1)
    .map((v, i) => `${i === 0 ? "M" : "L"}${X(i)},${Y(v)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: 240, display: "block" }}>
      <line x1={P} x2={W - P} y1={Y(target)} y2={Y(target)} stroke={C.red} strokeWidth="1" strokeDasharray="4 3" opacity="0.7" />
      <path d={`${d} L${X(TODAY)},${Y(0)} L${X(0)},${Y(0)} Z`} fill={C.indigo} opacity="0.15" />
      <path d={d} fill="none" stroke={C.indigo} strokeWidth="1.8" />
      <circle cx={X(TODAY)} cy={Y(real[TODAY] ?? 0)} r="3" fill={C.indigoHi} />
      <text x={W - P} y={Y(target) - 3} fontSize="8.5" fill={C.red} textAnchor="end" opacity="0.85">
        {target}%
      </text>
      <text x={X(TODAY)} y={H - 1} fontSize="8.5" fill={C.dim} textAnchor="middle">
        today
      </text>
    </svg>
  );
}

export const levelColor = (x: Metric, below: string = C.amber): string => {
  switch (metricLevel(x)) {
    case "stretch":
      return C.green;
    case "base":
      return C.indigoHi;
    case "below":
      return below;
  }
};

export function Bullet({ metric }: { metric: Metric }) {
  const cur = metric.current;
  const col = levelColor(metric);
  return (
    <div style={{ margin: "7px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
        <span style={{ color: C.mut }}>{metric.label}</span>
        <span style={{ color: col, fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{cur}%</span>
      </div>
      <div style={{ position: "relative", height: 7, borderRadius: 4, background: "#1B1E27" }}>
        <div style={{ position: "absolute", inset: 0, width: `${cur}%`, background: col, borderRadius: 4, opacity: 0.85, transition: "width .25s" }} />
        <div style={{ position: "absolute", top: -2.5, bottom: -2.5, left: `${metric.base}%`, width: 1.5, background: C.indigo }} />
        <div style={{ position: "absolute", top: -2.5, bottom: -2.5, left: `${metric.stretch}%`, width: 1.5, background: C.green }} />
      </div>
    </div>
  );
}

const STACK_ORDER: readonly GovStatus[] = ["approved", "in_review", "draft", "missing"];

export function GovStack({ counts }: { counts: Record<GovStatus, number> }) {
  return (
    <div>
      <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", margin: "6px 0 8px" }}>
        {STACK_ORDER.map((s) => (counts[s] ? <div key={s} style={{ flex: counts[s], background: GSTATUS_COLOR[s], opacity: 0.85 }} /> : null))}
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 10.5, color: C.dim }}>
        {STACK_ORDER.map((s) =>
          counts[s] ? (
            <span key={s}>
              <span style={{ color: GSTATUS_COLOR[s] }}>●</span> {counts[s]} {GSTATUS_LABEL[s].toLowerCase()}
            </span>
          ) : null,
        )}
      </div>
    </div>
  );
}

export const govCountsOf = (p: Pick<Project, "governance">): Record<GovStatus, number> => {
  const c: Record<GovStatus, number> = { approved: 0, in_review: 0, draft: 0, missing: 0, na: 0 };
  for (const g of p.governance) c[g.status] += 1;
  return c;
};

const rnd = (seed: number): number => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export function CommitBars({ seed, level }: { seed: number; level: number }) {
  const W = 700;
  const H = 120;
  const PL = 8;
  const PR = 8;
  const PT = 10;
  const PB = 20;
  const iw = W - PL - PR;
  const ih = H - PT - PB;
  const N = 56; // 8 weeks daily
  const vals = useMemo(
    () =>
      Array.from({ length: N }, (_, i) => {
        const wk = Math.sin(i / 3.2) * 0.3 + 0.7;
        const weekend = i % 7 === 5 || i % 7 === 6 ? 0.25 : 1;
        return Math.round(rnd(seed * 50 + i) * level * wk * weekend + (weekend === 1 ? 1 : 0));
      }),
    [seed, level],
  );
  const max = Math.max(...vals, 1);
  const bw = iw / N - 1.6;
  const total = vals.reduce((a, b) => a + b, 0);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }}>
        {vals.map((v, i) => (
          <rect
            key={i}
            x={PL + (i * iw) / N}
            y={PT + ih - (v / max) * ih}
            width={bw}
            height={Math.max(1.5, (v / max) * ih)}
            rx="1.5"
            fill={C.indigo}
            opacity={0.35 + 0.6 * (v / max)}
          />
        ))}
        <text x={PL} y={H - 6} fontSize="9" fill={C.dim}>
          8 weeks ago
        </text>
        <text x={W - PR} y={H - 6} fontSize="9" fill={C.dim} textAnchor="end">
          today
        </text>
      </svg>
      <div style={{ fontSize: 11, color: C.dim, padding: "2px 8px 0" }}>{total} commits · trailing 8 weeks · all repos</div>
    </div>
  );
}

export function PeopleBars({ people, field, color }: { people: Contributor[]; field: "commits" | "reviews"; color: string }) {
  const max = Math.max(...people.map((p) => p[field]), 1);
  const sorted = [...people].sort((a, b) => b[field] - a[field]);
  return (
    <div>
      {sorted.map((p) => (
        <div key={p.ini} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderTop: `1px solid ${C.line}` }}>
          <Avatar ini={p.ini} size={22} />
          <span style={{ fontSize: 12.5, color: C.text, width: 92, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
          <div style={{ flex: 1, height: 6, borderRadius: 3, background: "#1B1E27" }}>
            <div style={{ height: "100%", width: `${(p[field] / max) * 100}%`, background: color, borderRadius: 3, opacity: 0.8, transition: "width .3s" }} />
          </div>
          <span style={{ fontSize: 12, color: C.mut, width: 28, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{p[field]}</span>
        </div>
      ))}
    </div>
  );
}
