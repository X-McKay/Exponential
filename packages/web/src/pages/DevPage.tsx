import { CHECK_ICON } from "@valueflow/domain";
import type { DevActivity } from "@valueflow/domain";
import { CommitBars, PeopleBars } from "../charts/small.tsx";
import { Avatar, Chip, Kpi, SectionCard, ghostBtn } from "../ui/primitives.tsx";
import { C, CHECK_COLOR, gradeColor } from "../theme.ts";

export function DevPage({ d, onEdit }: { d: DevActivity | undefined; onEdit: () => void }) {
  if (!d)
    return (
      <div style={{ padding: "16px 20px 30px" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "48px 14px", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8 }}>
          <div style={{ fontSize: 13, color: C.text }}>No development activity connected</div>
          <div style={{ fontSize: 12, color: C.dim, textAlign: "center", maxWidth: 400 }}>This page mirrors CI and source control. Until an integration feeds it, you can add the data by hand.</div>
          <button type="button" className="vf-ghost" onClick={onEdit} style={{ ...ghostBtn, color: C.indigoHi }}>
            Add development data
          </button>
        </div>
      </div>
    );
  return (
    <div style={{ padding: "16px 20px 30px" }}>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <button type="button" className="vf-ghost" onClick={onEdit} style={ghostBtn}>
          Edit data
        </button>
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <Kpi label="Test coverage" value={`${d.stats.coverage}%`} sub="weighted across repos" color={d.stats.coverage >= 80 ? C.green : d.stats.coverage >= 65 ? C.amber : C.red} ring={d.stats.coverage / 100} />
        <Kpi label="Code quality" value={d.stats.quality} sub="static analysis grade" color={gradeColor(d.stats.quality)} />
        <Kpi label="Build success · 30d" value={`${d.stats.buildPass}%`} sub={`${d.stats.deploys} deploys`} color={d.stats.buildPass >= 95 ? C.green : C.amber} ring={d.stats.buildPass / 100} />
        <Kpi label="PRs merged · 30d" value={d.stats.mergedPRs} sub={`median review ${d.stats.medianReview}`} color={C.indigoHi} />
      </div>

      <SectionCard title="Commit activity" pad="10px 6px 8px">
        <CommitBars seed={d.activitySeed} level={d.activityLevel} />
      </SectionCard>

      <SectionCard title="Pull requests" pad="0 14px 6px">
        {d.prs.map((pr) => (
          <div key={pr.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: `1px solid ${C.line}` }}>
            <span style={{ fontSize: 12, color: CHECK_COLOR[pr.checks], width: 14, flexShrink: 0 }}>{CHECK_ICON[pr.checks]}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 13, color: pr.status === "merged" ? C.mut : C.text, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pr.title}</span>
              <span style={{ fontSize: 11, color: C.dim }}>
                {pr.id} · {pr.repo} · {pr.age} ago
              </span>
            </span>
            <span style={{ fontSize: 11, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
              <span style={{ color: C.green }}>+{pr.add}</span> <span style={{ color: C.red }}>−{pr.del}</span>
            </span>
            <span style={{ display: "flex", flexShrink: 0 }}>
              {pr.reviewers.map((r, i) => (
                <span key={r} style={{ marginLeft: i === 0 ? 0 : -6 }}>
                  <Avatar ini={r} size={20} />
                </span>
              ))}
            </span>
            <Chip tone={pr.status === "merged" ? "accent" : pr.checks === "fail" ? "bad" : "default"}>{pr.status === "merged" ? "Merged" : pr.checks === "fail" ? "Checks failing" : "Open"}</Chip>
            <Avatar ini={pr.author} size={20} />
          </div>
        ))}
      </SectionCard>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 340px", minWidth: 310 }}>
          <SectionCard title="Recent builds" pad="0 14px 6px">
            {d.builds.map((b) => (
              <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderTop: `1px solid ${C.line}` }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: b.status === "pass" ? C.green : C.red, flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13, color: b.status === "fail" ? C.text : C.mut, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.note}</span>
                  <span style={{ fontSize: 11, color: C.dim }}>
                    {b.id} · {b.repo} · {b.branch}
                  </span>
                </span>
                <span style={{ fontSize: 11, color: C.dim, textAlign: "right", flexShrink: 0 }}>
                  {b.when}
                  <br />
                  {b.dur}
                </span>
              </div>
            ))}
          </SectionCard>
          <SectionCard title="Repositories" pad="0 14px 6px">
            {d.repos.map((r) => (
              <div key={r.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderTop: `1px solid ${C.line}` }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13, color: C.text, display: "block" }}>{r.name}</span>
                  <span style={{ fontSize: 11, color: C.dim }}>
                    default: {r.branch} · {r.lang}
                  </span>
                </span>
                <Chip>{r.coverage}% cov</Chip>
                <Chip tone={r.quality.startsWith("A") ? "good" : "warn"}>{r.quality}</Chip>
              </div>
            ))}
          </SectionCard>
        </div>
        <div style={{ flex: "1 1 340px", minWidth: 310 }}>
          <SectionCard title="Top contributors · 30d" pad="4px 14px 8px">
            <PeopleBars people={d.people} field="commits" color={C.indigo} />
          </SectionCard>
          <SectionCard title="Top PR reviewers · 30d" pad="4px 14px 8px">
            <PeopleBars people={d.people} field="reviews" color={C.teal} />
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
