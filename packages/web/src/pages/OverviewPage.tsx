import { useEffect, useMemo, useState } from "react";
import { budgetLine, defaultBrief, explainReadiness, explainRuns, explainShipped, fmtTokens, fmtUsd, projectView, reReviewCadence, relTime, resolveWidget, runsInScope, spendOf } from "@valueflow/domain";
import type { AppState, Calendar, Project, ProjectTab } from "@valueflow/domain";
import { BriefBody } from "../ui/Brief.tsx";
import { Why } from "../ui/Explain.tsx";
import { Avatar, Chip, SectionCard, TierBadge, Tip, ghostBtn } from "../ui/primitives.tsx";
import { C } from "../theme.ts";

/**
 * A project's front page: today's brief on this project (written by the
 * curator from this project's signals, or composed from facts until it is),
 * then what the project is, who is on it, and the key facts, each of which
 * can explain itself.
 */
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
  onOpen: (id: string, tab: ProjectTab) => void;
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
  const [writing, setWriting] = useState(false);
  const prices = state.llm?.prices ?? {};
  const spend = useMemo(() => budgetLine(state, prices, "project", p.id), [state, prices, p.id]);
  const monthRuns = useMemo(() => runsInScope(state.runs, "project", p.id, state.asOf), [state.runs, p.id, state.asOf]);

  // Opening the page asks the server for the brief; it writes one only when what is stored is missing or stale.
  useEffect(() => {
    if (state.llm) void onCurate(p.id, false);
  }, [state.llm, p.id, onCurate]);

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

  return (
    <div style={{ padding: "16px 20px 30px" }}>
      <section style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 19, fontWeight: 550, letterSpacing: "-0.02em", lineHeight: 1.3, maxWidth: 760, marginBottom: 4 }}>Today on {p.name}</div>
        <div style={{ fontSize: 14.5, color: C.text2, lineHeight: 1.55, maxWidth: 680 }}>{live?.headline ?? own.headline}</div>
        <div style={{ fontSize: 11, color: C.dim, marginTop: 8, marginBottom: 6, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span>{live ? `Written by ${curator?.name ?? "the curator"} ${relTime(live.at, cal.asOf)}${live.model ? ` · ${live.model}` : ""}` : "Composed from live facts"}</span>
          {run && (
            <span style={{ display: "inline-flex", gap: 2, alignItems: "center" }}>
              <Tip label="Useful brief">
                <button type="button" aria-pressed={run.rating === 1} onClick={() => onRate(run.id, run.rating === 1 ? null : 1)} className="vf-ghost" style={{ ...ghostBtn, height: 22, padding: "0 6px", color: run.rating === 1 ? C.green : C.dim, borderColor: run.rating === 1 ? C.green : C.line2 }}>
                  👍
                </button>
              </Tip>
              <Tip label="Missed what mattered">
                <button type="button" aria-pressed={run.rating === -1} onClick={() => onRate(run.id, run.rating === -1 ? null : -1)} className="vf-ghost" style={{ ...ghostBtn, height: 22, padding: "0 6px", color: run.rating === -1 ? C.red : C.dim, borderColor: run.rating === -1 ? C.red : C.line2 }}>
                  👎
                </button>
              </Tip>
            </span>
          )}
          {state.llm && (
            <button
              type="button"
              className="vf-ghost"
              disabled={writing}
              onClick={() => {
                setWriting(true);
                void onCurate(p.id, true).finally(() => setWriting(false));
              }}
              style={{ ...ghostBtn, height: 22, fontSize: 11, opacity: writing ? 0.6 : 1 }}
            >
              {writing ? "Writing…" : live ? "Rewrite" : "Write with the model"}
            </button>
          )}
        </div>
        <BriefBody sections={live?.sections ?? own.sections} cal={cal} state={view} onOpen={onOpen} onOpenInbox={onOpenInbox} onOpenAgents={onOpenAgents} onDecide={onDecide} empty="Nothing needs you on this project right now." />
      </section>

      <SectionCard title="About" right={edit}>
        <div style={{ fontSize: 14, lineHeight: 1.65, color: C.text2 }}>{p.description}</div>
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
                <span style={{ fontSize: 13, color: C.text2, textAlign: "right" }}>{v}</span>
              </div>
            ))}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
