import { useMemo } from "react";
import { MONTHS, composeGlancePage } from "@valueflow/domain";
import type { AppState, Block, ProjectTab } from "@valueflow/domain";
import { Bullet, GovStack, Spark } from "../charts/small.tsx";
import { Chip, reset } from "../ui/primitives.tsx";
import { C, FEED_COLOR, toneBorder, toneToChip } from "../theme.ts";

/** Exhaustive renderer for every Glance card variant. */
function Body({ b }: { b: Block }) {
  switch (b.kind) {
    case "blocked_release":
      return (
        <div style={{ marginTop: 4 }}>
          {b.rows.map((row, i) => (
            <div key={i} style={{ display: "flex", gap: 8, padding: "4px 0", alignItems: "baseline" }}>
              <span style={{ fontSize: 11, color: row.eval.ok ? C.green : row.eval.pending ? C.amber : C.red, width: 12, flexShrink: 0 }}>{row.eval.ok ? "✓" : row.eval.pending ? "◐" : "✗"}</span>
              <span style={{ fontSize: 12, color: row.eval.ok ? C.dim : "#C6CAD6", flex: 1 }}>{row.label}</span>
              <span style={{ fontSize: 10.5, color: C.dim, flexShrink: 0 }}>{row.eval.sub}</span>
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
        <div style={{ fontSize: 11.5, color: C.dim, lineHeight: 1.6 }}>
          {b.pr.repo} · open {b.pr.age} · <span style={{ color: C.green }}>+{b.pr.add}</span> <span style={{ color: C.red }}>−{b.pr.del}</span>
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
          <Spark milestones={b.milestones} dim={b.dim} target={b.target} />
        </div>
      );
    case "ready_release":
      return (
        <div style={{ fontSize: 11.5, color: C.dim }}>
          Target {MONTHS[b.release.month]} · {b.release.milestoneIds.join(", ")}
        </div>
      );
    case "upcoming":
      return (
        <div style={{ marginTop: 2 }}>
          {b.items.map((u, i) => (
            <div key={i} style={{ display: "flex", gap: 8, padding: "4px 0", alignItems: "baseline" }}>
              <span style={{ fontSize: 10.5, color: C.mut, width: 40, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{u.date}</span>
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
              <span style={{ fontSize: 10.5, color: C.dim, flexShrink: 0 }}>{it.t}</span>
            </div>
          ))}
        </div>
      );
  }
}

function GlanceCard({ b, onOpen }: { b: Block; onOpen: (id: string, tab: ProjectTab) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(b.proj, b.tab)}
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
        transition: "border-color .15s, transform .15s, box-shadow .15s",
        textAlign: "left",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Chip tone={toneToChip(b.tone)}>{b.tag}</Chip>
        <span style={{ flex: 1 }} />
        {b.projName && <span style={{ fontSize: 10.5, color: C.dim }}>{b.projName}</span>}
        <span style={{ color: C.dim, fontSize: 11 }}>›</span>
      </div>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: C.text, lineHeight: 1.4 }}>{b.title}</div>
      <Body b={b} />
    </button>
  );
}

export function GlancePage({ state, userName, onOpen }: { state: AppState; userName: string; onOpen: (id: string, tab: ProjectTab) => void }) {
  const glance = useMemo(() => composeGlancePage(state), [state]);
  return (
    <div style={{ padding: "16px 20px 30px" }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 650, letterSpacing: "-0.01em", marginBottom: 6 }}>Morning, {userName} — here's where things stand.</div>
        <div style={{ fontSize: 13, lineHeight: 1.7, color: C.mut, maxWidth: 720 }}>{glance.narrative.join(" ")}</div>
        <div style={{ fontSize: 10.5, color: C.dim, marginTop: 8 }}>
          Composed from live state across {glance.projectCount} projects · cards appear, resize, and retire as conditions change
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        {glance.blocks.map((b) => (
          <GlanceCard key={`${b.kind}:${b.proj}:${b.title}`} b={b} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}
