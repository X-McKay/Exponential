import { blockers, readiness, reReviewCadence, shippedCount } from "@valueflow/domain";
import type { Project } from "@valueflow/domain";
import { Avatar, Chip, SectionCard, TierBadge, ghostBtn } from "../ui/primitives.tsx";
import { C } from "../theme.ts";

export function OverviewPage({ p, onEdit }: { p: Project; onEdit: () => void }) {
  const facts: [string, string][] = [
    ["Value targets", `FTE −${p.targets.fte}% · Time −${p.targets.time}%`],
    ["Milestones", `${shippedCount(p)} shipped of ${p.milestones.length}`],
    ["Governance readiness", `${Math.round(readiness(p) * 100)}% · ${blockers(p)} item(s) missing`],
    ["Risk re-review", reReviewCadence(p.tier)],
  ];
  const edit = (
    <button type="button" className="vf-ghost" onClick={onEdit} style={ghostBtn}>
      Edit
    </button>
  );
  return (
    <div style={{ padding: "16px 20px 30px" }}>
      <SectionCard title="About" right={edit}>
        <div style={{ fontSize: 14, lineHeight: 1.65, color: "#C6CAD6" }}>{p.description}</div>
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <Chip>{p.stage}</Chip>
          <TierBadge tier={p.tier} />
          {p.committee ? (
            <Chip tone="good">
              AI committee approved {p.committee.date} · {p.committee.ref}
            </Chip>
          ) : (
            <Chip tone="warn">AI committee review pending</Chip>
          )}
        </div>
      </SectionCard>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 320px", minWidth: 300 }}>
          <SectionCard title="Team" pad="8px 14px" right={edit}>
            {p.team.length === 0 && <div style={{ fontSize: 12, color: C.dim, padding: "8px 0" }}>No team members yet.</div>}
            {p.team.map((t) => (
              <div key={t.ini} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderTop: `1px solid ${C.line}` }}>
                <Avatar ini={t.ini} />
                <span style={{ fontSize: 13, color: C.text, flex: 1 }}>{t.name}</span>
                <span style={{ fontSize: 12, color: C.dim }}>{t.role}</span>
              </div>
            ))}
          </SectionCard>
        </div>
        <div style={{ flex: "1 1 320px", minWidth: 300 }}>
          <SectionCard title="Repositories" pad="8px 14px" right={edit}>
            {p.repos.length === 0 && <div style={{ fontSize: 12, color: C.dim, padding: "8px 0" }}>No repositories linked.</div>}
            {p.repos.map((r) => (
              <div key={r.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: `1px solid ${C.line}` }}>
                <span style={{ fontSize: 12, color: C.dim }}>⌥</span>
                <span style={{ fontSize: 13, color: C.text, flex: 1 }}>{r.name}</span>
                <a href={r.url.startsWith("http") ? r.url : `https://${r.url}`} target="_blank" rel="noreferrer" className="vf-link" style={{ fontSize: 12, color: C.indigoHi, textDecoration: "none" }}>
                  {r.url} ↗
                </a>
              </div>
            ))}
          </SectionCard>
          <SectionCard title="Key facts" pad="8px 14px">
            {facts.map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0", borderTop: `1px solid ${C.line}` }}>
                <span style={{ fontSize: 13, color: C.dim }}>{k}</span>
                <span style={{ fontSize: 13, color: "#C6CAD6", textAlign: "right" }}>{v}</span>
              </div>
            ))}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
