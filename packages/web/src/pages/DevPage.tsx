import { useState } from "react";
import { CHECK_ICON, deriveDev, durationLabel, relTime, shortAge } from "@valueflow/domain";
import type { DevFacts, Project, SyncRun } from "@valueflow/domain";
import { CommitBars, PeopleBars } from "../charts/small.tsx";
import { Avatar, Chip, Kpi, SectionCard, ghostBtn } from "../ui/primitives.tsx";
import { C, CHECK_COLOR, gradeColor } from "../theme.ts";

const syncLabel = (run: SyncRun | null, asOf: string, source: string | null): string => {
  if (!run) return source ? `never synced · source: ${source}` : "syncing is off (SYNC_SOURCE=none)";
  return `${run.ok ? "synced" : "sync failed"} ${relTime(run.finishedAt, asOf)} via ${run.source}${run.ok ? "" : " — " + run.message}`;
};

function SyncButton({ onSync, source }: { onSync: () => Promise<void>; source: string | null }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="vf-ghost"
      disabled={busy || !source}
      onClick={() => {
        setBusy(true);
        void onSync().finally(() => setBusy(false));
      }}
      style={{ ...ghostBtn, opacity: busy || !source ? 0.5 : 1 }}
    >
      {busy ? "Syncing…" : "Sync now"}
    </button>
  );
}

const pct = (v: number | null): string => (v === null ? "—" : `${v}%`);

export function DevPage({
  facts,
  project,
  asOf,
  source,
  onSync,
}: {
  facts: DevFacts | undefined;
  project: Project;
  asOf: string;
  source: string | null;
  onSync: () => Promise<void>;
}) {
  if (!facts || (facts.repos.length === 0 && facts.prs.length === 0 && facts.commits.length === 0))
    return (
      <div style={{ padding: "16px 20px 30px" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "48px 14px", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8 }}>
          <div style={{ fontSize: 13, color: C.text }}>No development activity synced</div>
          <div style={{ fontSize: 12, color: C.dim, textAlign: "center", maxWidth: 420 }}>
            {project.repos.length === 0
              ? "Link a repository on the Overview tab, then sync."
              : `This page mirrors source control and CI for ${project.repos.map((r) => r.name).join(", ")}. ${syncLabel(facts?.lastSync ?? null, asOf, source)}.`}
          </div>
          {project.repos.length > 0 && <SyncButton onSync={onSync} source={source} />}
        </div>
      </div>
    );
  const d = deriveDev(facts, project.team, asOf);
  const reviewLabel = d.stats.medianReviewH === null ? "no merges in 30d" : `median review ${d.stats.medianReviewH < 48 ? Math.round(d.stats.medianReviewH) + "h" : Math.round(d.stats.medianReviewH / 24) + "d"}`;
  return (
    <div style={{ padding: "16px 20px 30px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: C.dim, flex: 1 }}>{syncLabel(d.lastSync, asOf, source)}</span>
        <SyncButton onSync={onSync} source={source} />
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <Kpi
          label="Test coverage"
          value={pct(d.stats.coverage)}
          sub={d.stats.coverage === null ? "not reported by source" : "mean across repos"}
          color={d.stats.coverage === null ? C.dim : d.stats.coverage >= 80 ? C.green : d.stats.coverage >= 65 ? C.amber : C.red}
          ring={d.stats.coverage === null ? undefined : d.stats.coverage / 100}
        />
        <Kpi label="Code quality" value={d.stats.quality ?? "—"} sub={d.stats.quality === null ? "not reported by source" : "weakest repo grade"} color={d.stats.quality === null ? C.dim : gradeColor(d.stats.quality)} />
        <Kpi
          label="Build success · 30d"
          value={pct(d.stats.buildPass)}
          sub={`${d.stats.deploys} deploy${d.stats.deploys === 1 ? "" : "s"}`}
          color={d.stats.buildPass === null ? C.dim : d.stats.buildPass >= 95 ? C.green : C.amber}
          ring={d.stats.buildPass === null ? undefined : d.stats.buildPass / 100}
        />
        <Kpi label="PRs merged · 30d" value={d.stats.mergedPRs} sub={reviewLabel} color={C.indigoHi} />
      </div>

      <SectionCard title="Commit activity" pad="10px 6px 8px">
        <CommitBars days={d.days} repos={d.repos.length} />
      </SectionCard>

      <SectionCard title="Pull requests" pad="0 14px 6px">
        {d.prs.length === 0 && <div style={{ fontSize: 12, color: C.dim, padding: "12px 0 8px" }}>No pull requests in the sync window.</div>}
        {d.prs.map((pr) => (
          <div key={`${pr.repo}#${pr.number}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: `1px solid ${C.line}` }}>
            <span style={{ fontSize: 12, color: CHECK_COLOR[pr.checks], width: 14, flexShrink: 0 }}>{CHECK_ICON[pr.checks]}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              {pr.url ? (
                <a href={pr.url} target="_blank" rel="noreferrer" className="vf-link" style={{ fontSize: 13, color: pr.status === "merged" ? C.mut : C.text, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: "none" }}>
                  {pr.title}
                </a>
              ) : (
                <span style={{ fontSize: 13, color: pr.status === "merged" ? C.mut : C.text, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pr.title}</span>
              )}
              <span style={{ fontSize: 11, color: C.dim }}>
                #{pr.number} · {pr.repo} · {pr.status === "merged" && pr.mergedAt ? `merged ${shortAge(pr.mergedAt, asOf)} ago` : `open ${shortAge(pr.openedAt, asOf)}`}
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
            <Chip tone={pr.status === "merged" ? "accent" : pr.status === "closed" ? "default" : pr.checks === "fail" ? "bad" : "default"}>
              {pr.status === "merged" ? "Merged" : pr.status === "closed" ? "Closed" : pr.checks === "fail" ? "Checks failing" : "Open"}
            </Chip>
            <Avatar ini={pr.author} size={20} />
          </div>
        ))}
      </SectionCard>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 340px", minWidth: 310 }}>
          <SectionCard title="Recent builds" pad="0 14px 6px">
            {d.builds.length === 0 && <div style={{ fontSize: 12, color: C.dim, padding: "12px 0 8px" }}>No builds in the sync window.</div>}
            {d.builds.slice(0, 8).map((b) => (
              <div key={`${b.repo}/${b.id}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderTop: `1px solid ${C.line}` }}>
                <span className={b.status === "running" ? "vf-pulse" : undefined} style={{ width: 8, height: 8, borderRadius: "50%", background: b.status === "pass" ? C.green : b.status === "fail" ? C.red : C.amber, flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13, color: b.status === "fail" ? C.text : C.mut, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.note}</span>
                  <span style={{ fontSize: 11, color: C.dim }}>
                    {b.id.startsWith("#") ? b.id : `run ${b.id}`} · {b.repo} · {b.branch} · {b.kind}
                  </span>
                </span>
                <span style={{ fontSize: 11, color: C.dim, textAlign: "right", flexShrink: 0 }}>
                  {relTime(b.startedAt, asOf)}
                  <br />
                  {durationLabel(b.durationS)}
                </span>
              </div>
            ))}
          </SectionCard>
          <SectionCard title="Repositories" pad="0 14px 6px">
            {d.repos.map((r) => (
              <div key={r.repo} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderTop: `1px solid ${C.line}` }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13, color: C.text, display: "block" }}>{r.repo}</span>
                  <span style={{ fontSize: 11, color: C.dim }}>
                    default: {r.branch}
                    {r.lang ? ` · ${r.lang}` : ""}
                  </span>
                </span>
                {r.coverage !== null && <Chip>{r.coverage}% cov</Chip>}
                {r.quality !== null && <Chip tone={r.quality.startsWith("A") ? "good" : "warn"}>{r.quality}</Chip>}
              </div>
            ))}
          </SectionCard>
        </div>
        <div style={{ flex: "1 1 340px", minWidth: 310 }}>
          <SectionCard title="Top contributors · 30d" pad="4px 14px 8px">
            {d.people.length === 0 && <div style={{ fontSize: 12, color: C.dim, padding: "12px 0 8px" }}>No commits in the last 30 days.</div>}
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
