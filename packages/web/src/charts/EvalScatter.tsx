import { useEffect, useState } from "react";
import type { Metric, MetricReading } from "@valueflow/domain";
import { api } from "../api/client.ts";
import { C } from "../theme.ts";

/** Real eval history from metric_readings, re-fetched when the latest value changes. */
export function EvalScatter({ projectId, milestoneId, metric }: { projectId: string; milestoneId: string; metric: Metric }) {
  const [readings, setReadings] = useState<MetricReading[] | null>(null);
  useEffect(() => {
    let live = true;
    // Small delay so a debounced slider write lands before we read history back.
    const t = setTimeout(() => {
      api
        .readings(projectId, milestoneId, metric.id)
        .then((r) => {
          if (live) setReadings(r);
        })
        .catch(() => {
          if (live) setReadings([]);
        });
    }, 260);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [projectId, milestoneId, metric.id, metric.current]);

  const W = 640;
  const H = 160;
  const PL = 30;
  const PR = 8;
  const PT = 10;
  const PB = 20;
  const iw = W - PL - PR;
  const ih = H - PT - PB;
  const pts = readings ?? [];
  const N = Math.max(pts.length, 2);
  const X = (i: number) => PL + (i / (N - 1)) * iw;
  const Y = (v: number) => PT + ih - (v / 100) * ih;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }}>
      {[25, 50, 75, 100].map((v) => (
        <line key={v} x1={PL} x2={W - PR} y1={Y(v)} y2={Y(v)} stroke={C.line} strokeDasharray="3 5" />
      ))}
      <line x1={PL} x2={W - PR} y1={Y(metric.base)} y2={Y(metric.base)} stroke={C.indigo} strokeWidth="1.2" strokeDasharray="5 4" />
      <text x={W - PR - 2} y={Y(metric.base) - 4} fontSize="9" fill={C.indigo} textAnchor="end">
        base {metric.base}
      </text>
      <line x1={PL} x2={W - PR} y1={Y(metric.stretch)} y2={Y(metric.stretch)} stroke={C.green} strokeWidth="1.2" strokeDasharray="5 4" />
      <text x={W - PR - 2} y={Y(metric.stretch) - 4} fontSize="9" fill={C.green} textAnchor="end">
        stretch {metric.stretch}
      </text>
      {pts.map((r, i) => {
        const last = i === pts.length - 1;
        return (
          <circle
            key={`${r.recordedAt}-${i}`}
            cx={X(i)}
            cy={Y(r.value)}
            r={last ? 4 : 2.4}
            fill={last ? "#fff" : r.source === "manual" ? C.indigoHi : C.teal}
            opacity={last ? 1 : 0.35 + 0.6 * (i / N)}
          >
            <title>
              {r.value}% · {new Date(r.recordedAt).toLocaleDateString()} · {r.source}
            </title>
          </circle>
        );
      })}
      <text x={PL} y={H - 6} fontSize="9" fill={C.dim}>
        {readings === null ? "loading eval runs…" : pts.length ? `${pts.length} eval runs, trailing 8 weeks` : "no eval runs recorded"}
      </text>
      <text x={W - PR} y={H - 6} fontSize="9" fill={C.mut} textAnchor="end">
        latest {metric.current}%
      </text>
    </svg>
  );
}
