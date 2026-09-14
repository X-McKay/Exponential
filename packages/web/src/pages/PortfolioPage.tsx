import "./PortfolioPage.css";
import { TIER_LABEL, blockers, readiness, eligible, shippedCount } from "@valueflow/domain";
import type { Project } from "@valueflow/domain";
import { Ring, ghostBtn } from "../ui/primitives.tsx";
import { C } from "../theme.ts";

export function PortfolioPage({ projects, onOpen, onNew, onSetup, canSetup }: { projects: Project[]; onOpen: (id: string) => void; onNew: () => void; onSetup: () => void; canSetup: boolean }) {
  return (
    <div className="vf-portfolio" style={{ padding: "24px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 24 }}>
        <span style={{ fontSize: 12, color: C.mut, flex: 1 }}>
          {projects.length} project{projects.length === 1 ? "" : "s"} · Value, governance and delivery
        </span>
        <button type="button" className="vf-ghost" disabled={!canSetup} title={canSetup ? undefined : "Set LLM_BASE_URL to enable the setup agent"} onClick={onSetup} style={{ ...ghostBtn, color: C.indigoHi, opacity: canSetup ? 1 : 0.5 }}>
          Set up from documents…
        </button>
        <button type="button" className="vf-ghost" onClick={onNew} style={{ ...ghostBtn, color: C.indigoHi }}>
          + New project
        </button>
      </div>
      {projects.length === 0 && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "48px 14px", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12 }}>
          <div style={{ fontSize: 13, color: C.text }}>No projects yet</div>
          <div style={{ fontSize: 12, color: C.dim, textAlign: "center", maxWidth: 380 }}>
            Create a project by hand, or hand the setup agent a charter or deck and review what it drafts.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {canSetup && (
              <button type="button" className="vf-ghost" onClick={onSetup} style={{ ...ghostBtn, color: C.indigoHi }}>
                Set up from documents…
              </button>
            )}
            <button type="button" className="vf-ghost" onClick={onNew} style={{ ...ghostBtn, color: C.indigoHi }}>
              + New project
            </button>
          </div>
        </div>
      )}
      {projects.length > 0 && <div className="vf-portfolio-grid vf-portfolio-columns" aria-hidden="true">
        <span>Project</span><span>Eligible value · % reduction</span><span>Governance readiness</span><span>Delivery</span>
      </div>}
      <div style={{ display: "grid", gap: 12 }}>
        {projects.map((p) => {
          const r = readiness(p);
          const b = blockers(p);
          const shipped = shippedCount(p);
          const bars = (["fte", "time"] as const).map((dim) => ({ dim, value: eligible(p, dim), target: p.targets[dim] }))
            // A zero target alone does not mean a dimension is unused: retain any defined impact.
            .filter(({ dim, value, target }) => target > 0 || value > 0 || p.milestones.some((m) => m.impact.base[dim] > 0 || m.impact.stretch[dim] > 0));
          const risk = p.tier === 1 ? "high" : p.tier === 2 ? "medium" : p.tier === 3 ? "low" : "unset";
          return (
            <button key={p.id} type="button" onClick={() => onOpen(p.id)} className="vf-card vf-portfolio-grid vf-portfolio-row">
              <div className="vf-portfolio-identity">
                <div className="vf-portfolio-secondary">{p.key}</div>
                <div className="vf-portfolio-name">{p.name}</div>
                <div className="vf-portfolio-badges">
                  <span className="vf-portfolio-badge">{p.stage}</span>
                  <span className="vf-portfolio-badge vf-portfolio-risk" data-risk={risk}>
                    <span className="vf-portfolio-risk-dot" aria-hidden="true" />
                    {p.tier ? TIER_LABEL[p.tier] : "Untiered"}
                  </span>
                </div>
              </div>
              <div>
                <div className="vf-portfolio-mobile-label">Eligible value · % reduction</div>
                <div className="vf-portfolio-measures">
                  {bars.map(({ dim, value, target }) => <div key={dim}>
                    <div className="vf-portfolio-measure-heading">
                      <span className="vf-portfolio-secondary">{dim === "fte" ? "FTE" : "Time"}</span>
                      <span className="vf-portfolio-number">{value}% <span className="vf-portfolio-secondary">{target > 0 ? `/ ${target}% target` : "· No target set"}</span></span>
                    </div>
                    {target > 0 && <div className="vf-portfolio-bar" role="img" aria-label={`${dim === "fte" ? "FTE" : "Time"}: ${value}% eligible reduction against ${target}% target`}>
                      <span style={{ width: `${Math.min(100, Math.max(0, value / target * 100))}%` }} />
                    </div>}
                  </div>)}
                  {bars.length === 0 && <span className="vf-portfolio-secondary">No value targets or impacts set</span>}
                </div>
              </div>
              <div>
                <div className="vf-portfolio-mobile-label">Governance readiness</div>
                <div className="vf-portfolio-governance" aria-label={`${Math.round(r * 100)}% governance ready`}>
                  <Ring pct={r} size={32} stroke={4} color={C.indigoHi} />
                  <span className="vf-portfolio-number">{Math.round(r * 100)}%</span>
                </div>
                <span className={`vf-portfolio-badge vf-portfolio-${b > 0 ? "warning" : "good"}`}>{b > 0 ? `${b} item${b === 1 ? "" : "s"} missing` : "No missing items"}</span>
              </div>
              <div>
                <div className="vf-portfolio-mobile-label">Delivery</div>
                <div className="vf-portfolio-number">{shipped} <span className="vf-portfolio-secondary">/ {p.milestones.length}</span></div>
                <div className="vf-portfolio-secondary">milestones shipped</div>
                <div className="vf-portfolio-steps" aria-hidden="true">
                  {p.milestones.map((m, i) => <span key={m.id} data-done={i < shipped} />)}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
