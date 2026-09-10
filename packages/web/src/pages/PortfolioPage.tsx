import { blockers, readiness, realized, shippedCount } from "@valueflow/domain";
import type { Project } from "@valueflow/domain";
import { Avatar, Chip, Ring, TierBadge, reset } from "../ui/primitives.tsx";
import { C, readinessColor } from "../theme.ts";

export function PortfolioPage({ projects, onOpen }: { projects: Project[]; onOpen: (id: string) => void }) {
  return (
    <div style={{ padding: "18px 20px 30px" }}>
      <div style={{ fontSize: 13, color: C.mut, marginBottom: 14 }}>{projects.length} AI projects · value tied to performance gates · governance tracked per project</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
        {projects.map((p) => {
          const r = readiness(p);
          const b = blockers(p);
          const fte = realized(p, "fte");
          const time = realized(p, "time");
          const bars: [string, number, number][] = [
            ["FTE", fte, p.targets.fte],
            ["Time", time, p.targets.time],
          ];
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onOpen(p.id)}
              className="vf-card"
              style={{
                ...reset,
                flex: "1 1 300px",
                minWidth: 290,
                background: C.panel,
                border: `1px solid ${C.line}`,
                borderRadius: 12,
                padding: 16,
                transition: "border-color .12s, background .12s",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: C.dim }}>{p.key}</span>
                <Chip>{p.stage}</Chip>
                <span style={{ flex: 1 }} />
                <TierBadge tier={p.tier} />
              </div>
              <div style={{ fontSize: 15, fontWeight: 500, letterSpacing: "-0.01em", marginBottom: 10 }}>{p.name}</div>
              <div style={{ display: "flex", gap: 18, marginBottom: 12 }}>
                {bars.map(([l, v, tg]) => (
                  <div key={l} style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.dim, marginBottom: 4 }}>
                      <span>{l}</span>
                      <span style={{ color: C.indigoHi }}>
                        {v}% / {tg}%
                      </span>
                    </div>
                    <div style={{ height: 5, borderRadius: 4, background: "#1B1E27" }}>
                      <div style={{ height: "100%", width: `${tg > 0 ? Math.min(100, (v / tg) * 100) : 0}%`, background: "linear-gradient(90deg,#5C6AF0,#7B87F5)", borderRadius: 4 }} />
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Ring pct={r} size={26} stroke={3} color={readinessColor(r)} />
                <span style={{ fontSize: 12, color: C.mut }}>{Math.round(r * 100)}% governance ready</span>
                <span style={{ flex: 1 }} />
                {b > 0 ? <Chip tone="bad">{b} missing</Chip> : <Chip tone="good">no gaps</Chip>}
              </div>
              <div style={{ display: "flex", marginTop: 12, alignItems: "center" }}>
                {p.team.slice(0, 4).map((t, i) => (
                  <span key={t.ini} style={{ marginLeft: i === 0 ? 0 : -6 }}>
                    <Avatar ini={t.ini} size={22} />
                  </span>
                ))}
                <span style={{ fontSize: 11, color: C.dim, marginLeft: 8 }}>
                  {shippedCount(p)}/{p.milestones.length} milestones shipped
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
