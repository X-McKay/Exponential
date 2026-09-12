import { useEffect, useMemo, useState } from "react";
import { calendarOf, composeGlancePage, defaultBrief, describeAction, monthLabel, relTime, resolveWidget, shortAge } from "@valueflow/domain";
import type { AppState, Block, Calendar, ProjectTab } from "@valueflow/domain";
import { Bullet, GovStack, Spark } from "../charts/small.tsx";
import { Markdown } from "../editors/RunAgent.tsx";
import { BriefBody } from "../ui/Brief.tsx";
import { Btn, Caret, Chip, Tip, ghostBtn, reset } from "../ui/primitives.tsx";
import { SpendBar } from "../ui/Spend.tsx";
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
    case "budget":
      return (
        <div style={{ marginTop: 6 }}>
          <SpendBar line={b.line} label="Month to date" />
        </div>
      );
  }
}

function GlanceCard({ b, cal, state, onOpen, onOpenAgents, onOpenInbox, onDecide }: { b: Block; cal: Calendar; state: AppState; onOpen: (id: string, tab: ProjectTab) => void; onOpenAgents: () => void; onOpenInbox: () => void; onDecide: (id: string, d: "accept" | "dismiss") => void }) {
  const pending = b.kind === "agent_flag" ? state.proposals.filter((p) => p.runId === b.run.id && p.state === "pending").length : 0;
  const open = () => (b.kind === "decisions" ? onOpenInbox() : b.kind === "brief" || b.kind === "budget" || (b.kind === "agent_flag" && !b.run.proj) ? onOpenAgents() : onOpen(b.proj, b.tab));
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

      <BriefBody sections={sections} cal={cal} state={state} onOpen={onOpen} onOpenInbox={onOpenInbox} onOpenAgents={onOpenAgents} onDecide={onDecide} empty="Nothing needs you right now. The brief fills as releases block, gates slip, CI fails, agents flag, or proposals arrive." />

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
