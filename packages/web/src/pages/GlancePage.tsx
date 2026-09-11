import { useEffect, useMemo, useState } from "react";
import { BRIEF_GROUPS, calendarOf, composeGlancePage, defaultBrief, describeAction, monthLabel, relTime, resolveWidget, shortAge } from "@valueflow/domain";
import type { AppState, Block, BriefGroup, BriefSection, Calendar, ProjectTab, ResolvedWidget } from "@valueflow/domain";
import { Bullet, GovStack, Spark } from "../charts/small.tsx";
import { Markdown } from "../editors/RunAgent.tsx";
import { Btn, Caret, Chip, Tip, ghostBtn, reset } from "../ui/primitives.tsx";
import { C, FEED_COLOR, toneBorder, toneToChip } from "../theme.ts";

const BRIEF_HEADINGS = ["what moved", "what is blocked", "decisions waiting", "proposals pending", "where to look"];

/** Split a brief into its sections: `##` headings, or the brief's own section titles when the model wrote them as plain lines. */
export const sectionsOf = (markdown: string): { heading: string; body: string }[] => {
  const out: { heading: string; body: string }[] = [];
  let cur: { heading: string; body: string } | null = null;
  for (const line of markdown.split("\n")) {
    const h = line.match(/^#{1,4}\s+(.*)$/);
    const plain = line.trim().replace(/\*\*/g, "").replace(/:$/, "");
    const heading = h ? (h[1]?.trim() ?? "") : BRIEF_HEADINGS.some((k) => plain.toLowerCase().startsWith(k)) ? plain : null;
    if (heading !== null) {
      cur = { heading, body: "" };
      out.push(cur);
    } else if (cur) cur.body += `${line}\n`;
  }
  return out.map((s) => ({ ...s, body: s.body.trim() }));
};

const findSection = (sections: { heading: string; body: string }[], ...names: string[]) => sections.find((s) => names.some((n) => s.heading.toLowerCase().startsWith(n)));

/** "+n more" under a clipped list. */
function More({ n }: { n: number }) {
  return n > 0 ? <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>+{n} more</div> : null;
}

/** Exhaustive renderer for every Glance card variant. */
function Body({ b, cal, pending, state, onDecide }: { b: Block; cal: Calendar; pending: number; state: AppState; onDecide: (id: string, d: "accept" | "dismiss") => void }) {
  switch (b.kind) {
    case "decisions":
      return (
        <div style={{ marginTop: 4 }}>
          {b.proposals.map((p) => (
            <div key={p.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "5px 0", borderTop: `1px solid ${C.line}` }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 12.5, color: C.text2, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{describeAction(p.action, state, p.proj)}</span>
                <span style={{ fontSize: 11, color: C.dim }}>
                  {state.agents.find((a) => a.id === p.agentId)?.name ?? p.agentId}
                  {p.proj ? ` · ${state.projects.find((x) => x.id === p.proj)?.name ?? p.proj}` : ""}
                </span>
              </span>
              <span
                style={{ display: "inline-flex", gap: 4, flexShrink: 0 }}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                role="presentation"
              >
                <Btn onClick={() => onDecide(p.id, "dismiss")}>Dismiss</Btn>
                <Btn tone="primary" onClick={() => onDecide(p.id, "accept")}>
                  Accept
                </Btn>
              </span>
            </div>
          ))}
          <More n={b.more} />
        </div>
      );
    case "blocked_release":
      return (
        <div style={{ marginTop: 4 }}>
          {b.rows.map((row, i) => (
            <div key={i} style={{ display: "flex", gap: 8, padding: "4px 0", alignItems: "baseline" }}>
              <span style={{ fontSize: 11, color: row.eval.ok ? C.green : row.eval.pending ? C.amber : C.red, width: 12, flexShrink: 0 }}>{row.eval.ok ? "✓" : row.eval.pending ? "◐" : "✗"}</span>
              <span style={{ fontSize: 12, color: row.eval.ok ? C.dim : C.text2, flex: 1 }}>{row.label}</span>
              <span style={{ fontSize: 11, color: C.dim, flexShrink: 0 }}>{row.eval.sub}</span>
            </div>
          ))}
        </div>
      );
    case "below_gate":
      return (
        <div style={{ marginTop: 2 }}>
          {b.metrics.map((x) => (
            <Bullet key={x.id} metric={x} />
          ))}
        </div>
      );
    case "ci_failing":
      return (
        <div style={{ fontSize: 12, color: C.dim, lineHeight: 1.6 }}>
          {b.pr.repo} · open {shortAge(b.pr.openedAt, cal.asOf)} · <span style={{ color: C.green }}>+{b.pr.add}</span> <span style={{ color: C.red }}>−{b.pr.del}</span>
          {b.build && <div style={{ color: C.text2 }}>{b.build.note}</div>}
        </div>
      );
    case "tier1_gaps":
      return (
        <div>
          <GovStack counts={b.counts} />
          <div style={{ fontSize: 11, color: C.mut, marginTop: 6 }}>{b.missing.join(" · ")}</div>
        </div>
      );
    case "near_stretch":
      return (
        <div style={{ marginTop: 2 }}>
          {b.metrics.map((x) => (
            <Bullet key={x.id} metric={x} />
          ))}
        </div>
      );
    case "value_trajectory":
      return (
        <div style={{ marginTop: 4 }}>
          <Spark milestones={b.milestones} dim={b.dim} target={b.target} cal={cal} />
        </div>
      );
    case "ready_release":
      return (
        <div style={{ fontSize: 12, color: C.dim }}>
          Target {monthLabel(b.release.month, cal.todayYm)} · {b.release.milestoneIds.join(", ")}
        </div>
      );
    case "agent_flag":
      return (
        <div style={{ fontSize: 12, color: C.dim, lineHeight: 1.6 }}>
          {b.agentName} · {relTime(b.run.startedAt, cal.asOf)}
          {b.run.model ? ` · ${b.run.model}` : ""}
          {pending > 0 ? ` · ${pending} proposal${pending === 1 ? "" : "s"} to review on Agents` : ""}
          <div style={{ color: C.text2 }}>
            {b.run.output
              .split("\n")
              .find((l) => l.trim() && !l.startsWith("#"))
              ?.replace(/\*\*|`/g, "")
              .slice(0, 160) ?? "Open the Agents page for the full report."}
          </div>
        </div>
      );
    case "brief": {
      // The narrative above already carries what moved; the card keeps what waits on the reader.
      const sections = sectionsOf(b.run.output);
      const decisions = findSection(sections, "decisions");
      const pendingSec = findSection(sections, "proposals");
      const blocked = findSection(sections, "what is blocked", "blocked");
      const show = [decisions, pendingSec, blocked].filter((s): s is { heading: string; body: string } => s !== undefined).slice(0, 2);
      return (
        <div style={{ marginTop: 2 }}>
          <div style={{ fontSize: 11, color: C.dim, marginBottom: 4 }}>
            {b.agentName} · {relTime(b.run.startedAt, cal.asOf)} · open for the full brief
          </div>
          {show.length ? show.map((s) => <Markdown key={s.heading} text={`### ${s.heading}\n${s.body.split("\n").slice(0, 4).join("\n")}`} />) : <Markdown text={b.run.output.split("\n## Where to look")[0]?.split("\n").slice(0, 6).join("\n") ?? ""} />}
        </div>
      );
    }
    case "upcoming":
      return (
        <div style={{ marginTop: 2 }}>
          {b.items.map((u, i) => (
            <div key={i} style={{ display: "flex", gap: 8, padding: "4px 0", alignItems: "baseline" }}>
              <span style={{ fontSize: 11, color: C.mut, width: 40, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{u.date}</span>
              <span style={{ fontSize: 12, color: C.text2, flex: 1 }}>{u.text}</span>
            </div>
          ))}
          <More n={b.more} />
        </div>
      );
    case "activity":
      return (
        <div style={{ marginTop: 2 }}>
          {b.items.map((it, i) => (
            <div key={i} style={{ display: "flex", gap: 8, padding: "4px 0", alignItems: "center" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: FEED_COLOR[it.type], flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: C.text2, flex: 1, lineHeight: 1.5 }}>{it.text}</span>
              <span style={{ fontSize: 11, color: C.dim, flexShrink: 0 }}>{relTime(it.at, cal.asOf)}</span>
            </div>
          ))}
          <More n={b.more} />
        </div>
      );
  }
}

function GlanceCard({ b, cal, state, onOpen, onOpenAgents, onOpenInbox, onDecide }: { b: Block; cal: Calendar; state: AppState; onOpen: (id: string, tab: ProjectTab) => void; onOpenAgents: () => void; onOpenInbox: () => void; onDecide: (id: string, d: "accept" | "dismiss") => void }) {
  const pending = b.kind === "agent_flag" ? state.proposals.filter((p) => p.runId === b.run.id && p.state === "pending").length : 0;
  const open = () => (b.kind === "decisions" ? onOpenInbox() : b.kind === "brief" || (b.kind === "agent_flag" && !b.run.proj) ? onOpenAgents() : onOpen(b.proj, b.tab));
  return (
    <div
      role="link"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter") open();
      }}
      className="vf-card vf-pop"
      style={{
        ...reset,
        flex: b.span === 2 ? "2 1 440px" : "1 1 290px",
        minWidth: 280,
        minHeight: 200,
        background: C.panel,
        border: `1px solid ${toneBorder(b.tone)}`,
        borderRadius: 12,
        padding: "13px 15px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        transition: "border-color .12s, background .12s",
        textAlign: "left",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Chip tone={toneToChip(b.tone)}>{b.tag}</Chip>
        <span style={{ flex: 1 }} />
        {b.projName && <span style={{ fontSize: 11, color: C.dim }}>{b.projName}</span>}
        <span style={{ color: C.dim, fontSize: 11 }}>›</span>
      </div>
      <div style={{ fontSize: 14, fontWeight: 500, color: C.text, lineHeight: 1.4, letterSpacing: "-0.01em", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{b.title}</div>
      <div style={{ maxHeight: 148, overflow: "hidden", position: "relative", flex: 1 }}>
        <Body b={b} cal={cal} pending={pending} state={state} onDecide={onDecide} />
        <span aria-hidden style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 22, background: `linear-gradient(to bottom, transparent, ${C.panel})`, pointerEvents: "none" }} />
      </div>
    </div>
  );
}

// ---- widgets --------------------------------------------------------------

const Row = ({ children, borderTop }: { children: React.ReactNode; borderTop?: boolean }) => <div style={{ display: "flex", gap: 8, padding: "5px 0", alignItems: "baseline", borderTop: borderTop ? `1px solid ${C.line}` : "none" }}>{children}</div>;

/** One widget from the brief, rendered from live facts. */
function WidgetView({ w, cal, state, onOpen, onDecide }: { w: ResolvedWidget; cal: Calendar; state: AppState; onOpen: (id: string, tab: ProjectTab) => void; onDecide: (id: string, d: "accept" | "dismiss") => void }) {
  const caption = (text: string, proj: string, tab: ProjectTab) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
      <span style={{ fontSize: 11, color: C.dim, flex: 1 }}>{text}</span>
      <button type="button" className="vf-ghost" onClick={() => onOpen(proj, tab)} style={{ ...ghostBtn, height: 20, fontSize: 11, padding: "0 6px" }}>
        open ↗
      </button>
    </div>
  );
  switch (w.type) {
    case "metric":
      return (
        <div>
          {caption(`${w.project.name} · ${w.milestone.name}`, w.project.id, "value")}
          <Bullet metric={w.metric} />
        </div>
      );
    case "gates":
      return (
        <div>
          {caption(`${w.project.name} · ${w.milestone.name} · gates`, w.project.id, "value")}
          {w.milestone.metrics.map((x) => (
            <Bullet key={x.id} metric={x} />
          ))}
        </div>
      );
    case "release":
      return (
        <div>
          {caption(`${w.project.name} · ${w.release.id} ${w.release.name} · ${w.state.label} · ${w.state.met}/${w.state.total} criteria · target ${monthLabel(w.release.month, cal.todayYm)}`, w.project.id, "roadmap")}
          {w.rows.map((row, i) => (
            <Row key={i}>
              <span style={{ fontSize: 11, color: row.eval.ok ? C.green : row.eval.pending ? C.amber : C.red, width: 12, flexShrink: 0 }}>{row.eval.ok ? "✓" : row.eval.pending ? "◐" : "✗"}</span>
              <span style={{ fontSize: 12.5, color: row.eval.ok ? C.dim : C.text2, flex: 1 }}>{row.label}</span>
              <span style={{ fontSize: 11, color: C.dim, flexShrink: 0 }}>{row.eval.sub}</span>
            </Row>
          ))}
        </div>
      );
    case "governance":
      return (
        <div>
          {caption(`${w.project.name} · governance`, w.project.id, "governance")}
          <GovStack counts={w.counts} />
          {w.missing.length > 0 && <div style={{ fontSize: 11.5, color: C.mut, marginTop: 4 }}>Missing: {w.missing.join(" · ")}</div>}
        </div>
      );
    case "value":
      return (
        <div>
          {caption(`${w.project.name} · ${w.realized}% of ${w.target}% ${w.dim === "fte" ? "FTE" : "time"} target realized`, w.project.id, "value")}
          <Spark milestones={w.project.milestones} dim={w.dim} target={w.target} cal={cal} />
        </div>
      );
    case "proposals":
      return (
        <div>
          {w.proposals.map((p, i) => (
            <div key={p.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "6px 0", borderTop: i === 0 ? "none" : `1px solid ${C.line}` }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 12.5, color: C.text2, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{describeAction(p.action, state, p.proj)}</span>
                <span style={{ fontSize: 11, color: C.dim }}>
                  {state.agents.find((a) => a.id === p.agentId)?.name ?? p.agentId}
                  {p.proj ? ` · ${state.projects.find((x) => x.id === p.proj)?.name ?? p.proj}` : ""}
                  {p.state !== "pending" ? ` · ${p.state}` : ""}
                </span>
              </span>
              {p.state === "pending" && (
                <span style={{ display: "inline-flex", gap: 4, flexShrink: 0 }}>
                  <Btn onClick={() => onDecide(p.id, "dismiss")}>Dismiss</Btn>
                  <Btn tone="primary" onClick={() => onDecide(p.id, "accept")}>
                    Accept
                  </Btn>
                </span>
              )}
            </div>
          ))}
        </div>
      );
    case "ci":
      return (
        <div>
          {caption(`${w.project.name} · ${w.pr.repo} #${w.pr.number} · open ${shortAge(w.pr.openedAt, cal.asOf)}`, w.project.id, "development")}
          <div style={{ fontSize: 12.5, color: C.text2 }}>{w.pr.title}</div>
          <div style={{ fontSize: 11.5, color: C.dim, marginTop: 2 }}>
            checks {w.pr.checks} · <span style={{ color: C.green }}>+{w.pr.add}</span> <span style={{ color: C.red }}>−{w.pr.del}</span>
            {w.build ? ` · ${w.build.note}` : ""}
          </div>
        </div>
      );
    case "upcoming":
      return (
        <div>
          {w.items.map((u, i) => (
            <Row key={i} borderTop={i > 0}>
              <span style={{ fontSize: 11, color: C.mut, width: 44, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{u.date}</span>
              <span style={{ fontSize: 12.5, color: C.text2, flex: 1 }}>{u.text}</span>
              <button type="button" className="vf-link" onClick={() => onOpen(u.proj, u.tab)} style={{ ...reset, fontSize: 11, color: C.dim }}>
                {state.projects.find((p) => p.id === u.proj)?.name.split(" ").slice(0, 2).join(" ") ?? u.proj}
              </button>
            </Row>
          ))}
        </div>
      );
    case "activity":
      return (
        <div>
          {w.items.map((it, i) => (
            <Row key={i} borderTop={i > 0}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: FEED_COLOR[it.type], flexShrink: 0, alignSelf: "center" }} />
              <span style={{ fontSize: 12.5, color: C.text2, flex: 1 }}>{it.text}</span>
              <span style={{ fontSize: 11, color: C.dim, flexShrink: 0 }}>{relTime(it.at, cal.asOf)}</span>
            </Row>
          ))}
        </div>
      );
    case "table":
      return (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 12.5, whiteSpace: "nowrap" }}>
            <thead>
              <tr>
                {w.columns.map((c, i) => (
                  <th key={i} style={{ textAlign: "left", fontWeight: 500, color: C.dim, fontSize: 11, padding: "3px 14px 5px 0", borderBottom: `1px solid ${C.line}` }}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {w.rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((cell, ci) => (
                    <td key={ci} style={{ padding: "4px 14px 4px 0", color: C.text2, borderBottom: `1px solid ${C.line}` }}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

const GROUP_LABEL: Record<BriefGroup, string> = { top: "Top of mind", fyi: "FYI" };

/** One item: a hollow bullet, a short snippet, an action link, a muted tip, and a widget only when one was warranted. */
function Item({ section, cal, state, onOpen, onOpenInbox, onDecide }: { section: BriefSection; cal: Calendar; state: AppState; onOpen: (id: string, tab: ProjectTab) => void; onOpenInbox: () => void; onDecide: (id: string, d: "accept" | "dismiss") => void }) {
  const w = section.widget ? resolveWidget(section.widget, state, cal) : null;
  const action = section.action ?? null;
  const go = () => (action ? (action.proj === "inbox" ? onOpenInbox() : onOpen(action.proj, action.tab)) : undefined);
  return (
    <li style={{ display: "flex", gap: 14, padding: "12px 0 16px", listStyle: "none" }}>
      <span aria-hidden style={{ width: 7, height: 7, borderRadius: "50%", border: `1.5px solid ${C.mut}`, flexShrink: 0, marginTop: 8 }} />
      <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 8 }}>
        <div style={{ fontSize: 14.5, lineHeight: 1.6, color: C.text, maxWidth: 680 }}>{section.text}</div>
        {action && (
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <button type="button" onClick={go} className="vf-link" style={{ ...reset, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: C.text2 }}>
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={{ color: C.dim }}>
                <path d="M6 8.5a3 3 0 0 0 4.2 0l1.8-1.8a3 3 0 0 0-4.2-4.2L7 3.3M8 5.5a3 3 0 0 0-4.2 0L2 7.3a3 3 0 0 0 4.2 4.2L7 10.7" />
              </svg>
              {action.label}
            </button>
          </div>
        )}
        {section.tip && <div style={{ fontSize: 13, lineHeight: 1.55, color: C.mut, borderLeft: `2px solid ${C.line2}`, paddingLeft: 12, maxWidth: 640 }}>{section.tip}</div>}
        {w && (
          <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, padding: "10px 14px", maxWidth: 680 }}>
            <WidgetView w={w} cal={cal} state={state} onOpen={onOpen} onDecide={onDecide} />
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * The daily brief: a headline, a few paragraphs of need-to-know, and a widget
 * under a paragraph wherever a visual earns its place. With a model the
 * curator writes it from the composer's signals; without one the composer
 * writes its own. Every widget renders from live facts. The composer's cards
 * remain available underneath as "all signals".
 */
export function GlancePage({
  state,
  userName,
  onOpen,
  onOpenAgents,
  onOpenInbox,
  onDecide,
  onRate,
  onCurate,
  onSeen,
}: {
  state: AppState;
  userName: string;
  onOpen: (id: string, tab: ProjectTab) => void;
  onOpenAgents: () => void;
  onOpenInbox: () => void;
  onDecide: (id: string, d: "accept" | "dismiss") => void;
  onRate: (runId: string, rating: 1 | -1 | null) => void;
  onCurate: () => Promise<void>;
  onSeen: () => void;
}) {
  const cal = useMemo(() => calendarOf(state), [state]);
  const glance = useMemo(() => composeGlancePage(state, cal), [state, cal]);
  const own = useMemo(() => defaultBrief(state, cal), [state, cal]);
  const [showAll, setShowAll] = useState(false);
  const [curating, setCurating] = useState(false);
  const brief = state.brief;
  // A curated brief whose every widget has gone stale reads as out of date; the composer's own takes over.
  const live = brief && brief.sections.some((s) => !s.widget || resolveWidget(s.widget, state, cal)) ? brief : null;
  const headline = live?.headline ?? own.headline;
  const sections = live?.sections ?? own.sections;
  const run = live ? state.runs.find((r) => r.id === live.runId) : undefined;
  const curator = state.agents.find((a) => a.kind === "curator");
  const waiting = state.proposals.filter((p) => p.state === "pending").length;

  // A visit counts after a moment on the page; the next visit's activity starts here.
  useEffect(() => {
    const t = setTimeout(onSeen, 4000);
    return () => clearTimeout(t);
  }, [onSeen]);

  return (
    <div style={{ padding: "16px 20px 30px" }}>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 22, fontWeight: 550, letterSpacing: "-0.02em", lineHeight: 1.3, maxWidth: 760, marginBottom: 6 }}>Hey {userName}, here's what today has in store.</div>
        <div style={{ fontSize: 14.5, color: C.text2, lineHeight: 1.55, maxWidth: 680 }}>{headline}</div>
        <div style={{ fontSize: 11, color: C.dim, marginTop: 8, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span>
            {live ? `Written by ${curator?.name ?? "the curator"} ${relTime(live.at, cal.asOf)}${live.model ? ` · ${live.model}` : ""}` : "Composed from live state"} · {glance.projectCount} projects · {glance.blocks.length} signal{glance.blocks.length === 1 ? "" : "s"}
          </span>
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
              disabled={curating}
              onClick={() => {
                setCurating(true);
                void onCurate().finally(() => setCurating(false));
              }}
              style={{ ...ghostBtn, height: 22, fontSize: 11, opacity: curating ? 0.6 : 1 }}
            >
              {curating ? "Writing…" : live ? "Rewrite" : "Write with the model"}
            </button>
          )}
          {waiting > 0 && (
            <button type="button" className="vf-ghost" onClick={onOpenInbox} style={{ ...ghostBtn, height: 22, fontSize: 11, color: C.indigoHi }}>
              {waiting} in the inbox ›
            </button>
          )}
        </div>
      </div>

      {BRIEF_GROUPS.map((g) => {
        const items = sections.filter((sec) => (sec.group ?? "top") === g);
        if (items.length === 0) return null;
        return (
          <section key={g} style={{ marginBottom: 22 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.text, letterSpacing: "-0.01em", paddingBottom: 4, borderBottom: `1px solid ${C.line}` }}>{GROUP_LABEL[g]}</div>
            <ul style={{ margin: 0, padding: 0 }}>
              {items.map((sec, i) => (
                <Item key={i} section={sec} cal={cal} state={state} onOpen={onOpen} onOpenInbox={onOpenInbox} onDecide={onDecide} />
              ))}
            </ul>
          </section>
        );
      })}
      {sections.length === 0 && (
        <div style={{ padding: "28px 14px", textAlign: "center", color: C.dim, fontSize: 13, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12 }}>
          Nothing needs you right now. The brief fills as releases block, gates slip, CI fails, agents flag, or proposals arrive.
        </div>
      )}

      {glance.blocks.length > 0 && (
        <section>
          <button type="button" onClick={() => setShowAll((v) => !v)} className="vf-row" style={{ ...reset, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: C.dim, padding: "6px 8px", borderRadius: 6, marginBottom: 8 }}>
            <Caret open={showAll} /> All {glance.blocks.length} signals
            {!showAll && <span style={{ color: C.dim2 }}> · {glance.blocks.map((b) => b.tag).join(", ")}</span>}
          </button>
          {showAll && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
              {glance.blocks.map((b) => (
                <GlanceCard key={b.id} b={b} cal={cal} state={state} onOpen={onOpen} onOpenAgents={onOpenAgents} onOpenInbox={onOpenInbox} onDecide={onDecide} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
