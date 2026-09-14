// Small charts: sparkline, bullet gauge, governance stack, commit bars, people bars.

import { useMemo } from "react";
import { GSTATUS_LABEL, burnupSeries, metricLevel } from "@valueflow/domain";
import type { Calendar, Contributor, DayCount, Dim, GovStatus, Metric, Milestone, Project } from "@valueflow/domain";
import { Avatar } from "../ui/primitives.tsx";
import { C, GSTATUS_COLOR } from "../theme.ts";

export function Spark({ milestones, historicalMilestones, dim, target, cal }: { milestones: Milestone[]; historicalMilestones?: Milestone[]; dim: Dim; target: number; cal: Calendar }) {
  const MONTHS = cal.months;
  const TODAY = cal.today;
  const W = 220;
  const H = 56;
  const P = 4;
  const iw = W - P * 2;
  const ih = H - P * 2 - 10;
  const X = (i: number) => P + (i / (MONTHS.length - 1)) * iw;
  const real = burnupSeries(milestones, dim, cal, historicalMilestones).real;
  const known = real.filter((v): v is number => typeof v === "number");
  const yMax = Math.max(target ?? 0, ...known, 1);
  const Y = (v: number) => P + ih - (v / yMax) * ih;
  const d = real
    .slice(0, TODAY + 1)
    .map((v, i) => (typeof v !== "number" ? null : `${i === 0 || typeof real[i - 1] !== "number" ? "M" : "L"}${X(i)},${Y(v)}`))
    .filter((v): v is string => v !== null)
    .join(" ");
  const firstKnown = real.findIndex((v, i) => i <= TODAY && typeof v === "number");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: 240, display: "block" }}>
      <line x1={P} x2={W - P} y1={Y(target)} y2={Y(target)} stroke={C.red} strokeWidth="1" strokeDasharray="4 3" opacity="0.7" />
      {d && firstKnown >= 0 && <path d={`${d} L${X(TODAY)},${Y(0)} L${X(firstKnown)},${Y(0)} Z`} fill={C.indigo} opacity="0.15" />}
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
  const cur = metric.current ?? 0;
  const col = levelColor(metric);
  return (
    <div style={{ margin: "7px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
        <span style={{ color: C.mut }}>{metric.label}</span>
        <span style={{ color: col, fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>{cur}%</span>
      </div>
      <div style={{ position: "relative", height: 7, borderRadius: 4, background: C.field }}>
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
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11, color: C.dim }}>
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

/** Daily commit counts (real, from commit_days), oldest first. */
export function CommitBars({ days, repos }: { days: DayCount[]; repos: number }) {
  const W = 700;
  const H = 120;
  const PL = 8;
  const PR = 8;
  const PT = 10;
  const PB = 20;
  const iw = W - PL - PR;
  const ih = H - PT - PB;
  const N = Math.max(days.length, 1);
  const vals = useMemo(() => days.map((d) => d.count), [days]);
  const max = Math.max(...vals, 1);
  const bw = iw / N - 1.6;
  const total = vals.reduce((a, b) => a + b, 0);
  const weeks = Math.round(N / 7);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }}>
        {vals.map((v, i) => (
          <rect
            key={days[i]?.day ?? i}
            x={PL + (i * iw) / N}
            y={PT + ih - (v / max) * ih}
            width={bw}
            height={Math.max(1.5, (v / max) * ih)}
            rx="1.5"
            fill={C.indigo}
            opacity={0.35 + 0.6 * (v / max)}
          >
            <title>
              {days[i]?.day}: {v} commit{v === 1 ? "" : "s"}
            </title>
          </rect>
        ))}
        <text x={PL} y={H - 6} fontSize="9" fill={C.dim}>
          {weeks} weeks ago
        </text>
        <text x={W - PR} y={H - 6} fontSize="9" fill={C.dim} textAnchor="end">
          today
        </text>
      </svg>
      <div style={{ fontSize: 11, color: C.dim, padding: "2px 8px 0" }}>
        {total} commits · trailing {weeks} weeks · {repos} repo{repos === 1 ? "" : "s"}
      </div>
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
          <span style={{ fontSize: 13, color: C.text, width: 92, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
          <div style={{ flex: 1, height: 6, borderRadius: 4, background: C.field }}>
            <div style={{ height: "100%", width: `${(p[field] / max) * 100}%`, background: color, borderRadius: 4, opacity: 0.8, transition: "width .3s" }} />
          </div>
          <span style={{ fontSize: 12, color: C.mut, width: 28, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{p[field]}</span>
        </div>
      ))}
    </div>
  );
}
