// ================= brief rendering =================
//
// The daily brief's items and widgets, shared by Glance (the workspace) and
// each project's overview (one project). Every widget renders from live
// facts; the brief only points at them.

import { BRIEF_GROUPS, describeAction, monthLabel, relTime, resolveWidget, shortAge } from "@valueflow/domain";
import type { AppState, BriefGroup, BriefSection, Calendar, ProjectTab, ResolvedWidget } from "@valueflow/domain";
import { Bullet, GovStack, Spark } from "../charts/small.tsx";
import { Btn, ghostBtn, reset } from "./primitives.tsx";
import { C, FEED_COLOR } from "../theme.ts";

// ---- widgets --------------------------------------------------------------

const Row = ({ children, borderTop }: { children: React.ReactNode; borderTop?: boolean }) => <div style={{ display: "flex", gap: 8, padding: "5px 0", alignItems: "baseline", borderTop: borderTop ? `1px solid ${C.line}` : "none" }}>{children}</div>;

/** One widget from the brief, rendered from live facts. */
export function WidgetView({ w, cal, state, onOpen, onDecide }: { w: ResolvedWidget; cal: Calendar; state: AppState; onOpen: (id: string, tab: ProjectTab) => void; onDecide: (id: string, d: "accept" | "dismiss") => void }) {
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

export const GROUP_LABEL: Record<BriefGroup, string> = { top: "Top of mind", fyi: "FYI" };

/** One item: a hollow bullet, a short snippet, an action link, a muted tip, and a widget only when one was warranted. */
export function Item({ section, cal, state, onOpen, onOpenInbox, onOpenAgents, onDecide }: { section: BriefSection; cal: Calendar; state: AppState; onOpen: (id: string, tab: ProjectTab) => void; onOpenInbox: () => void; onOpenAgents: () => void; onDecide: (id: string, d: "accept" | "dismiss") => void }) {
  const w = section.widget ? resolveWidget(section.widget, state, cal) : null;
  const action = section.action ?? null;
  const go = () => (action ? (action.proj === "inbox" ? onOpenInbox() : action.proj === "agents" ? onOpenAgents() : onOpen(action.proj, action.tab)) : undefined);
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


/** The brief's items under their group headings, plus the empty state. */
export function BriefBody({ sections, cal, state, onOpen, onOpenInbox, onOpenAgents, onDecide, empty }: { sections: BriefSection[]; cal: Calendar; state: AppState; onOpen: (id: string, tab: ProjectTab) => void; onOpenInbox: () => void; onOpenAgents: () => void; onDecide: (id: string, d: "accept" | "dismiss") => void; empty: string }) {
  return (
    <>
      {BRIEF_GROUPS.map((g) => {
        const items = sections.filter((sec) => (sec.group ?? "top") === g);
        if (items.length === 0) return null;
        return (
          <section key={g} style={{ marginBottom: 22 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.text, letterSpacing: "-0.01em", paddingBottom: 4, borderBottom: `1px solid ${C.line}` }}>{GROUP_LABEL[g]}</div>
            <ul style={{ margin: 0, padding: 0 }}>
              {items.map((sec, i) => (
                <Item key={i} section={sec} cal={cal} state={state} onOpen={onOpen} onOpenInbox={onOpenInbox} onOpenAgents={onOpenAgents} onDecide={onDecide} />
              ))}
            </ul>
          </section>
        );
      })}
      {sections.length === 0 && <div style={{ padding: "28px 14px", textAlign: "center", color: C.dim, fontSize: 13, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12 }}>{empty}</div>}
    </>
  );
}
