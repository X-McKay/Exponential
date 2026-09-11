import { useMemo } from "react";
import { calendarOf, composeGlancePage, monthLabel, relTime, shortAge } from "@valueflow/domain";
import type { AppState, Block, Calendar, ProjectTab } from "@valueflow/domain";
import { Bullet, GovStack, Spark } from "../charts/small.tsx";
import { Markdown } from "../editors/RunAgent.tsx";
import { Chip, reset } from "../ui/primitives.tsx";
import { C, FEED_COLOR, toneBorder, toneToChip } from "../theme.ts";

/** Exhaustive renderer for every Glance card variant. */
function Body({ b, cal, pending }: { b: Block; cal: Calendar; pending: number }) {
  switch (b.kind) {
    case "blocked_release":
      return (
        <div style={{ marginTop: 4 }}>
          {b.rows.map((row, i) => (
            <div key={i} style={{ display: "flex", gap: 8, padding: "4px 0", alignItems: "baseline" }}>
              <span style={{ fontSize: 11, color: row.eval.ok ? C.green : row.eval.pending ? C.amber : C.red, width: 12, flexShrink: 0 }}>{row.eval.ok ? "✓" : row.eval.pending ? "◐" : "✗"}</span>
              <span style={{ fontSize: 12, color: row.eval.ok ? C.dim : "#C6CAD6", flex: 1 }}>{row.label}</span>
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
          {b.build && <div style={{ color: "#C6CAD6" }}>{b.build.note}</div>}
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
          <div style={{ color: "#C6CAD6" }}>
            {b.run.output
              .split("\n")
              .find((l) => l.trim() && !l.startsWith("#"))
              ?.replace(/\*\*|`/g, "")
              .slice(0, 160) ?? "Open the Agents page for the full report."}
          </div>
        </div>
      );
    case "brief":
      return (
        <div style={{ marginTop: 2, maxHeight: 260, overflowY: "auto", paddingRight: 4 }}>
          <div style={{ fontSize: 11, color: C.dim, marginBottom: 4 }}>
            {b.agentName} · {relTime(b.run.startedAt, cal.asOf)} · open Agents for the full brief
          </div>
          <Markdown text={b.run.output.split("\n## Where to look")[0] ?? ""} />
        </div>
      );
    case "upcoming":
      return (
        <div style={{ marginTop: 2 }}>
          {b.items.map((u, i) => (
            <div key={i} style={{ display: "flex", gap: 8, padding: "4px 0", alignItems: "baseline" }}>
              <span style={{ fontSize: 11, color: C.mut, width: 40, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{u.date}</span>
              <span style={{ fontSize: 12, color: "#C6CAD6", flex: 1 }}>{u.text}</span>
            </div>
          ))}
        </div>
      );
    case "activity":
      return (
        <div style={{ marginTop: 2 }}>
          {b.items.map((it, i) => (
            <div key={i} style={{ display: "flex", gap: 8, padding: "4px 0", alignItems: "center" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: FEED_COLOR[it.type], flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: "#C6CAD6", flex: 1, lineHeight: 1.5 }}>{it.text}</span>
              <span style={{ fontSize: 11, color: C.dim, flexShrink: 0 }}>{relTime(it.at, cal.asOf)}</span>
            </div>
          ))}
        </div>
      );
  }
}

function GlanceCard({ b, cal, pending, onOpen, onOpenAgents }: { b: Block; cal: Calendar; pending: number; onOpen: (id: string, tab: ProjectTab) => void; onOpenAgents: () => void }) {
  return (
    <button
      type="button"
      onClick={() => (b.kind === "brief" || (b.kind === "agent_flag" && !b.run.proj) ? onOpenAgents() : onOpen(b.proj, b.tab))}
      className="vf-card vf-pop"
      style={{
        ...reset,
        flex: b.span === 2 ? "2 1 440px" : "1 1 290px",
        minWidth: 280,
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
      <div style={{ fontSize: 14, fontWeight: 500, color: C.text, lineHeight: 1.4, letterSpacing: "-0.01em" }}>{b.title}</div>
      <Body b={b} cal={cal} pending={pending} />
    </button>
  );
}

export function GlancePage({ state, userName, onOpen, onOpenAgents }: { state: AppState; userName: string; onOpen: (id: string, tab: ProjectTab) => void; onOpenAgents: () => void }) {
  const cal = useMemo(() => calendarOf(state), [state]);
  const glance = useMemo(() => composeGlancePage(state, cal), [state, cal]);
  return (
    <div style={{ padding: "16px 20px 30px" }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 550, letterSpacing: "-0.015em", marginBottom: 6 }}>Morning, {userName} — here's where things stand.</div>
        <div style={{ fontSize: 13, lineHeight: 1.7, color: C.mut, maxWidth: 720 }}>{glance.narrative.join(" ")}</div>
        <div style={{ fontSize: 11, color: C.dim, marginTop: 8 }}>
          Composed from live state across {glance.projectCount} projects · cards appear, resize, and retire as conditions change
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        {glance.blocks.map((b) => (
          <GlanceCard
            key={`${b.kind}:${b.proj}:${b.title}`}
            b={b}
            cal={cal}
            pending={b.kind === "agent_flag" ? state.proposals.filter((p) => p.runId === b.run.id && p.state === "pending").length : 0}
            onOpen={onOpen}
            onOpenAgents={onOpenAgents}
          />
        ))}
      </div>
    </div>
  );
}
