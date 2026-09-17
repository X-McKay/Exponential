// ================= agent economics =================
//
// What the agents cost and what came of it: spend beside accepted proposals,
// by agent, project, and template, over the same trailing window the quality
// tables use. Every number derives from runs and proposals (economics.ts in
// the domain package); nothing is stored. Bars are one hue for one measure
// (share of spend) and every figure is also in the table, so nothing is read
// from colour alone.

import { useMemo, useState } from "react";
import { economics, fmtTokens, fmtUsd } from "@valueflow/domain";
import type { Agent, AgentRun, EconomicsLine, PriceList, Project, ProjectTemplate, Proposal } from "@valueflow/domain";
import { Kpi, SectionCard, Tip } from "./primitives.tsx";
import { C } from "../theme.ts";

const th: React.CSSProperties = { fontSize: 10.5, color: C.dim, letterSpacing: "0.05em", textTransform: "uppercase", textAlign: "right", padding: "8px 10px", fontWeight: 500, whiteSpace: "nowrap", borderBottom: `1px solid ${C.line}` };
const td: React.CSSProperties = { fontSize: 13, padding: "8px 10px", color: C.text2, whiteSpace: "nowrap", verticalAlign: "middle", borderTop: `1px solid ${C.line}`, textAlign: "right", fontVariantNumeric: "tabular-nums" };

const pct = (v: number | null): string => (v === null ? "—" : `${Math.round(v * 100)}%`);
const spendOf = (l: EconomicsLine, priced: boolean): string => (l.tokens === 0 ? "—" : priced && l.usd !== null ? `${fmtUsd(l.usd)}${l.unpriced ? ` +${l.unpriced} unpriced` : ""}` : `${fmtTokens(l.tokens)} tokens`);
const perAccepted = (l: EconomicsLine, priced: boolean): string => (l.accepted === 0 ? "—" : priced && l.usdPerAccepted !== null ? fmtUsd(l.usdPerAccepted) : l.tokensPerAccepted !== null ? `${fmtTokens(Math.round(l.tokensPerAccepted))} tokens` : "—");

/** A thin share bar: one hue, anchored left, 4px rounded end; the number sits beside it in text ink. */
function ShareBar({ share, label }: { share: number; label: string }) {
  const w = Math.max(0, Math.min(1, share));
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 120 }}>
      <span aria-hidden style={{ flex: 1, height: 6, borderRadius: 3, background: C.field, overflow: "hidden", minWidth: 60 }}>
        <span style={{ display: "block", height: "100%", width: `${Math.round(w * 100)}%`, minWidth: w > 0 ? 3 : 0, background: C.indigo, borderRadius: "0 3px 3px 0", transition: "width .3s" }} />
      </span>
      <span style={{ fontSize: 12, color: C.text2, width: 36, textAlign: "right" }}>{label}</span>
    </span>
  );
}

function LinesTable({ title, lines, priced, first, onOpen }: { title: string; lines: EconomicsLine[]; priced: boolean; first: string; onOpen?: (id: string) => void }) {
  return (
    <SectionCard title={title} pad="0">
      {lines.length === 0 ? (
        <div style={{ padding: 14, fontSize: 12, color: C.dim }}>No runs or proposals in the window.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 760 }}>
            <thead>
              <tr>
                <th scope="col" style={{ ...th, textAlign: "left", paddingLeft: 14 }}>{first}</th>
                <th scope="col" style={th}>Runs</th>
                <th scope="col" style={th}>Spend</th>
                <th scope="col" style={{ ...th, textAlign: "left" }}>Share of spend</th>
                <th scope="col" style={th}>Proposed</th>
                <th scope="col" style={th}>Accepted</th>
                <th scope="col" style={th}>Acceptance</th>
                <th scope="col" style={{ ...th, paddingRight: 14 }}>Per accepted</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id || "workspace"}>
                  <th scope="row" style={{ ...td, textAlign: "left", paddingLeft: 14, fontWeight: 500, color: C.text, whiteSpace: "normal", overflowWrap: "anywhere" }}>
                    {onOpen && l.id ? <button type="button" className="vf-link" onClick={() => onOpen(l.id)} style={{ all: "unset", cursor: "pointer", color: C.text }}>{l.name}</button> : l.name}
                  </th>
                  <td style={td}>{l.runs}{l.failed ? <span style={{ color: C.red, fontSize: 11 }}> · {l.failed} failed</span> : null}</td>
                  <td style={td}>
                    <Tip label={`${fmtTokens(l.tokens)} tokens across ${l.runs} run${l.runs === 1 ? "" : "s"}${l.unpriced ? `; ${l.unpriced} run${l.unpriced === 1 ? "" : "s"} used a model without a price` : ""}`}>
                      <span>{spendOf(l, priced)}</span>
                    </Tip>
                  </td>
                  <td style={{ ...td, textAlign: "left" }}><ShareBar share={l.share} label={pct(l.share)} /></td>
                  <td style={td}>{l.proposals}{l.pending ? <span style={{ color: C.dim, fontSize: 11 }}> · {l.pending} waiting</span> : null}</td>
                  <td style={{ ...td, color: l.accepted ? C.greenHi : C.text2 }}>{l.accepted}{l.dismissed ? <span style={{ color: C.dim, fontSize: 11 }}> · {l.dismissed} dismissed</span> : null}</td>
                  <td style={td}>{pct(l.acceptanceRate)}</td>
                  <td style={{ ...td, paddingRight: 14, fontWeight: 500, color: l.accepted ? C.text : C.dim }}>{perAccepted(l, priced)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

/**
 * The economics section of the Agents page: what the window cost, what people
 * accepted, and the cost of each accepted change, by agent, project, and template.
 */
export function EconomicsPanel({ agents, projects, templates, runs, proposals, prices, asOf, onOpenProject, onOpenAgent }: {
  agents: Agent[]; projects: Project[]; templates: ProjectTemplate[]; runs: AgentRun[]; proposals: Proposal[]; prices: PriceList; asOf: string;
  onOpenProject?: (id: string) => void; onOpenAgent?: (id: string) => void;
}) {
  const [group, setGroup] = useState<"agent" | "project" | "template">("agent");
  const e = useMemo(() => economics({ agents, projects, templates, runs, proposals }, prices, asOf), [agents, projects, templates, runs, proposals, prices, asOf]);
  const t = e.total;
  const decided = t.accepted + t.dismissed;
  const best = e.byAgent.filter((l) => l.accepted > 0).sort((a, b) => (a.usdPerAccepted ?? a.tokensPerAccepted ?? Infinity) - (b.usdPerAccepted ?? b.tokensPerAccepted ?? Infinity))[0];
  const idle = e.byAgent.filter((l) => l.runs > 0 && l.proposals === 0);
  return (
    <div>
      <div className="vf-kpis">
        <Kpi label={`Spend · ${e.windowDays}d`} value={spendOf(t, e.priced)} sub={e.priced ? `${fmtTokens(t.tokens)} tokens · ${t.runs} run${t.runs === 1 ? "" : "s"}` : t.tokens ? "set LLM_PRICES to see dollars" : "no runs in the window"} color={t.tokens ? C.indigoHi : C.dim} />
        <Kpi label="Accepted changes" value={t.accepted} sub={decided ? `${pct(t.acceptanceRate)} of ${decided} decided · ${t.pending} waiting` : t.proposals ? `${t.pending} waiting on a decision` : "nothing proposed"} color={t.accepted ? C.green : C.dim} ring={t.acceptanceRate === null ? undefined : t.acceptanceRate} />
        <Kpi label="Cost per accepted change" value={perAccepted(t, e.priced)} sub={t.accepted ? "spend in the window over changes people applied" : "no accepted changes yet"} color={t.accepted ? C.text : C.dim} />
        <Kpi label="Best value agent" value={best ? best.name : "—"} sub={best ? `${perAccepted(best, e.priced)} per accepted change · ${best.accepted} accepted` : "needs an accepted change"} color={best ? C.greenHi : C.dim} />
        <Kpi label="Spend without proposals" value={idle.length} sub={idle.length ? `${idle.map((l) => l.name).slice(0, 3).join(", ")}${idle.length > 3 ? "…" : ""}: briefs, answers, and judging` : "every spending agent proposed something"} color={idle.length ? C.amber : C.dim} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12, flexWrap: "wrap" }} role="group" aria-label="Group economics by">
        {(["agent", "project", "template"] as const).map((g) => (
          <button key={g} type="button" className="vf-ghost" aria-pressed={group === g} onClick={() => setGroup(g)} style={{ all: "unset", boxSizing: "border-box", cursor: "pointer", fontSize: 12, height: 26, padding: "0 10px", borderRadius: 6, border: `1px solid ${group === g ? C.accentLine2 : C.line2}`, color: group === g ? C.text : C.mut, background: group === g ? C.accentSoft : "transparent" }}>
            By {g}
          </button>
        ))}
        <span className="vf-hint" style={{ fontSize: 11, color: C.dim, marginLeft: "auto" }}>
          {e.windowDays}-day window · spend from every run's token counts{e.priced ? " and LLM_PRICES" : ""} · outcomes from the inbox
        </span>
      </div>
      {group === "agent" && <LinesTable title="By agent" first="Agent" lines={e.byAgent} priced={e.priced} onOpen={onOpenAgent} />}
      {group === "project" && <LinesTable title="By project" first="Project" lines={e.byProject} priced={e.priced} onOpen={onOpenProject} />}
      {group === "template" && <LinesTable title="By template" first="Template" lines={e.byTemplate} priced={e.priced} />}
      <div style={{ fontSize: 12, color: C.dim, lineHeight: 1.6, maxWidth: 720 }}>
        Benchmark runs count toward spend but never toward proposals. A project's line counts runs briefed with it and proposals that target it; workspace-wide runs (briefs, tuning, scouting) sit on their own line. A template's line sums the projects that follow it.
      </div>
    </div>
  );
}
