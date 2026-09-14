import { useEffect, useMemo, useState } from "react";
import { budgetLine, defaultBrief, eligible, explainEligible, explainReadiness, explainRuns, explainShipped, fmtTokens, fmtUsd, monthLabel, projectView, reReviewCadence, relTime, releaseState, resolveWidget, runsInScope, spendOf } from "@valueflow/domain";
import type { AgentRun, AppState, Calendar, Project, ProjectTab } from "@valueflow/domain";
import { focusRelease, releaseBlockers } from "../releaseFocus.ts";
import { BriefBody } from "../ui/Brief.tsx";
import { Why } from "../ui/Explain.tsx";
import { Avatar, Chip, SectionCard, TierBadge, Tip, ghostBtn } from "../ui/primitives.tsx";
import { C } from "../theme.ts";

function CompactKpi({ label, value, sub, color = C.text }: { label: string; value: React.ReactNode; sub: React.ReactNode; color?: string }) {
  return (
    <div style={{ minWidth: 0, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, padding: "10px 12px" }}>
      <div style={{ fontSize: 11, color: C.mut, marginBottom: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 550, color, letterSpacing: "-0.02em", lineHeight: 1.1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
      <div style={{ fontSize: 11, color: C.dim, marginTop: 5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</div>
    </div>
  );
}

/** A project's front page: status and the next action first, context second. */
export function OverviewPage({
  p,
  state,
  cal,
  onEdit,
  onOpen,
  onOpenInbox,
  onOpenAgents,
  onDecide,
  onRate,
  onCurate,
}: {
  p: Project;
  state: AppState;
  cal: Calendar;
  onEdit: () => void;
  onOpen: (id: string, tab: ProjectTab, focusId?: string) => void;
  onOpenInbox: () => void;
  onOpenAgents: () => void;
  onDecide: (id: string, d: "accept" | "dismiss") => void;
  onRate: (runId: string, rating: 1 | -1 | null) => void;
  onCurate: (pid: string, force: boolean) => Promise<void>;
}) {
  const view = useMemo(() => projectView(state, p.id), [state, p.id]);
  const own = useMemo(() => defaultBrief(view, cal, "project"), [view, cal]);
  const brief = view.brief;
  const live = brief && brief.sections.some((s) => !s.widget || resolveWidget(s.widget, view, cal)) ? brief : null;
  const run = live ? state.runs.find((r) => r.id === live.runId) : undefined;
  const curator = state.agents.find((a) => a.kind === "curator");
  const [briefOpen, setBriefOpen] = useState(false);
  const [writing, setWriting] = useState(false);
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth < 640);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 639px)");
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
  const prices = state.llm?.prices ?? {};
  const releases = state.releases[p.id] ?? [];
  const nextPlanned = useMemo(
    () => releases.filter((r) => r.month >= cal.todayYm).sort((a, b) => a.month.localeCompare(b.month))[0],
    [releases, cal.todayYm],
  );
  const release = useMemo(() => focusRelease(releases, p, cal), [releases, p, cal]);
  const releaseStatus = release ? releaseState(release, p, cal) : undefined;
  const openBlockers = useMemo(() => (release ? releaseBlockers(release, p, cal) : []), [release, p, cal]);

  // budgetLine selects state.usageRuns when the usage ledger is available.
  const spend = useMemo(() => budgetLine(state, prices, "project", p.id), [state, prices, p.id]);
  const accountingRuns = (state as typeof state & { usageRuns?: AgentRun[] }).usageRuns ?? state.runs;
  const monthRuns = useMemo(() => runsInScope(accountingRuns, "project", p.id, state.asOf), [accountingRuns, p.id, state.asOf]);

  const edit = (
    <button type="button" className="vf-ghost" onClick={onEdit} style={ghostBtn}>
      Edit
    </button>
  );
  const facts: [string, React.ReactNode][] = [
    ["Value targets", `FTE −${p.targets.fte}% · Time −${p.targets.time}%`],
    ["Milestones", <Why key="ms" e={() => explainShipped(p, cal)}>{`${p.milestones.filter((m) => m.status === "shipped").length} shipped of ${p.milestones.length}`}</Why>],
    ["Governance readiness", <Why key="gov" e={() => explainReadiness(p)}>{`${explainReadiness(p).value} · ${p.governance.filter((g) => g.status === "missing").length} item(s) missing`}</Why>],
    ["Risk re-review", reReviewCadence(p.tier)],
    [
      "Agent spend · month",
      <Why key="spend" e={() => explainRuns("Agent spend on this project this month", spend.spend.usd !== null ? `${fmtUsd(spend.spend.usd)} · ${fmtTokens(spend.spend.tokens)} tokens` : `${fmtTokens(spend.spend.tokens)} tokens`, `every run on ${p.name} since the first of the month; tokens from the model's usage report${Object.keys(prices).length ? ", dollars from LLM_PRICES" : ""}`, monthRuns, state, (r) => {
        const s = spendOf([r], prices);
        return `${s.usd !== null ? `${fmtUsd(s.usd)} · ` : ""}${fmtTokens(s.tokens)} tokens`;
      })}>
        {spend.spend.tokens ? `${spend.spend.usd !== null ? `${fmtUsd(spend.spend.usd)} · ` : ""}${fmtTokens(spend.spend.tokens)} tokens · ${spend.spend.runs} run${spend.spend.runs === 1 ? "" : "s"}` : "no runs yet"}
        {spend.budget ? ` · ${Math.round((spend.used ?? 0) * 100)}% of budget` : ""}
      </Why>,
    ],
  ];

  const blockerTone = releaseStatus?.label === "Blocked" ? "bad" : releaseStatus?.label === "Ready" ? "good" : "warn";
  const openBlocker = () => onOpen(p.id, "roadmap", release?.id);

  return (
    <div style={{ padding: "16px 20px 30px" }}>
      <section aria-label="Project status" style={{ display: "grid", gridTemplateColumns: narrow ? "repeat(2, minmax(0, 1fr))" : "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 14 }}>
        <CompactKpi label="Project status" value={p.stage} sub={p.tier ? `Tier ${p.tier}` : "Risk tier not set"} color={C.text} />
        <CompactKpi label="Next planned release" value={nextPlanned?.id ?? "—"} sub={nextPlanned ? `${nextPlanned.name} · ${monthLabel(nextPlanned.month, cal.todayYm)}` : "No release scheduled"} color={C.indigoHi} />
        <CompactKpi label="FTE reduction eligible" value={<Why e={() => explainEligible(p, "fte")}>{`${eligible(p, "fte")}%`}</Why>} sub={`of ${p.targets.fte}% target`} color={C.indigoHi} />
        <CompactKpi label="Time reduction eligible" value={<Why e={() => explainEligible(p, "time")}>{`${eligible(p, "time")}%`}</Why>} sub={`of ${p.targets.time}% target`} color={C.indigoHi} />
      </section>

      <SectionCard
        title={release ? `${release.id} · ${release.name}` : "Release blockers"}
        right={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            {releaseStatus && <Chip tone={blockerTone}>{releaseStatus.label}</Chip>}
            <button type="button" className="vf-ghost" onClick={openBlocker} style={{ ...ghostBtn, minHeight: 36, color: C.indigoHi }}>
              {openBlockers.length ? "Review blockers" : "Open roadmap"}
            </button>
          </span>
        }
        pad="10px 14px"
      >
        {release ? (
          <>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: openBlockers.length ? 8 : 0 }}>
              <span style={{ fontSize: 12, color: C.dim }}>Target month</span>
              <span style={{ fontSize: 13, color: C.text }}>{monthLabel(release.month, cal.todayYm)}</span>
              <span style={{ fontSize: 12, color: C.dim }}>·</span>
              <span style={{ fontSize: 12, color: C.mut }}>{releaseStatus?.met ?? 0}/{releaseStatus?.total ?? release.criteria.length} criteria met</span>
            </div>
            {openBlockers.length > 0 ? (
              <div style={{ borderTop: `1px solid ${C.line}` }}>
                {openBlockers.map((b) => (
                  <div key={`${b.tab}:${b.focusId}:${b.index}`} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "9px 0", borderBottom: `1px solid ${C.line}` }}>
                    <span style={{ color: b.evaluation.pending ? C.amber : C.red, fontSize: 13, width: 14, flexShrink: 0 }}>{b.evaluation.pending ? "◐" : "!"}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 13, color: C.text }}>{b.criterion.label}</span>
                      <span style={{ display: "block", fontSize: 11, color: C.dim, marginTop: 2 }}>{b.evaluation.sub}{b.owner ? ` · owner ${b.owner}` : ""}</span>
                    </span>
                    <button type="button" className="vf-ghost" onClick={() => onOpen(p.id, b.tab, b.focusId)} style={{ ...ghostBtn, minHeight: 36, flexShrink: 0 }}>
                      {b.label}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: C.mut }}>No open criteria on this release. Check the roadmap for the complete delivery picture.</div>
            )}
          </>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 12, color: C.mut }}>
            No release is planned yet. Add one to connect delivery criteria to the project status.
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Project brief"
        right={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            {live && <span style={{ fontSize: 11, color: C.dim }}>Updated {relTime(live.at, cal.asOf)}</span>}
            {state.llm && (
              <button
                type="button"
                className="vf-ghost"
                disabled={writing}
                onClick={() => {
                  setWriting(true);
                  void onCurate(p.id, true).finally(() => setWriting(false));
                }}
                style={{ ...ghostBtn, height: 24, fontSize: 11, opacity: writing ? 0.6 : 1 }}
              >
                {writing ? "Writing…" : live ? "Refresh" : "Generate"}
              </button>
            )}
          </span>
        }
        pad="10px 14px"
      >
        <details open={briefOpen} onToggle={(e) => setBriefOpen(e.currentTarget.open)}>
          <summary style={{ cursor: "pointer", color: C.text, fontSize: 14, lineHeight: 1.5 }}>
            Read project brief <span style={{ fontSize: 12, color: C.dim }}>{live ? "· curated update" : "· composed from live facts"}</span>
          </summary>
          {briefOpen && (
            <div style={{ paddingTop: 10 }}>
              <div style={{ fontSize: 14, color: C.text2, lineHeight: 1.5, marginBottom: 10 }}>{live?.headline ?? own.headline}</div>
              <div style={{ fontSize: 11, color: C.dim, marginBottom: 8, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span>{live ? `Written by ${curator?.name ?? "the curator"} ${relTime(live.at, cal.asOf)}${live.model ? ` · ${live.model}` : ""}` : "Composed from live facts"}</span>
                {run && (
                  <span style={{ display: "inline-flex", gap: 2, alignItems: "center" }}>
                    <Tip label="Useful brief">
                      <button type="button" aria-pressed={run.rating === 1} onClick={() => onRate(run.id, run.rating === 1 ? null : 1)} className="vf-ghost" style={{ ...ghostBtn, height: 22, padding: "0 6px", color: run.rating === 1 ? C.green : C.dim, borderColor: run.rating === 1 ? C.green : C.line2 }}>👍</button>
                    </Tip>
                    <Tip label="Missed what mattered">
                      <button type="button" aria-pressed={run.rating === -1} onClick={() => onRate(run.id, run.rating === -1 ? null : -1)} className="vf-ghost" style={{ ...ghostBtn, height: 22, padding: "0 6px", color: run.rating === -1 ? C.red : C.dim, borderColor: run.rating === -1 ? C.red : C.line2 }}>👎</button>
                    </Tip>
                  </span>
                )}
              </div>
              <BriefBody sections={live?.sections ?? own.sections} cal={cal} state={view} onOpen={onOpen} onOpenInbox={onOpenInbox} onOpenAgents={onOpenAgents} onDecide={onDecide} empty="Nothing needs you on this project right now." />
            </div>
          )}
        </details>
      </SectionCard>

      <SectionCard title="About" right={edit}>
        <div style={{ fontSize: 14, lineHeight: 1.65, color: C.text2 }}>{p.description}</div>
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <Chip>{p.stage}</Chip>
          <TierBadge tier={p.tier} />
          {p.committee ? <Chip tone="good">AI committee approved {p.committee.date} · {p.committee.ref}</Chip> : <Chip tone="warn">AI committee review pending</Chip>}
        </div>
      </SectionCard>

      <div style={{ display: "grid", gridTemplateColumns: narrow ? "minmax(0, 1fr)" : "repeat(2, minmax(0, 1fr))", gap: 14 }}>
        <div style={{ minWidth: 0 }}>
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
        <div style={{ minWidth: 0 }}>
          <SectionCard title="Repositories" pad="8px 14px" right={edit}>
            {p.repos.length === 0 && <div style={{ fontSize: 12, color: C.dim, padding: "8px 0" }}>No repositories linked.</div>}
            {p.repos.map((r) => (
              <div key={r.name} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", minWidth: 0, padding: "8px 0", borderTop: `1px solid ${C.line}` }}>
                <span style={{ fontSize: 12, color: C.dim }}>⌥</span>
                <span style={{ fontSize: 13, color: C.text, flex: "1 1 140px", minWidth: 0, overflowWrap: "anywhere" }}>{r.name}</span>
                <a href={r.url.startsWith("http") ? r.url : `https://${r.url}`} target="_blank" rel="noreferrer" className="vf-link" style={{ fontSize: 12, color: C.indigoHi, flex: "1 1 140px", minWidth: 0, overflowWrap: "anywhere", textAlign: "right", textDecoration: "none" }}>{r.url} ↗</a>
              </div>
            ))}
          </SectionCard>
          <SectionCard title="Key facts" pad="8px 14px">
            {facts.map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0", borderTop: `1px solid ${C.line}` }}>
                <span style={{ fontSize: 13, color: C.dim }}>{k}</span>
                <span style={{ fontSize: 13, color: C.text2, textAlign: "right" }}>{v}</span>
              </div>
            ))}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
