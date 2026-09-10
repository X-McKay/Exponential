import { useState } from "react";
import { MONTHS, TODAY, nextRelease, releaseState } from "@valueflow/domain";
import type { Project, Release } from "@valueflow/domain";
import { RoadmapTimeline } from "../charts/RoadmapTimeline.tsx";
import { Caret, Chip, Kpi, SectionCard, reset } from "../ui/primitives.tsx";
import { C, releaseToneColor } from "../theme.ts";

export function RoadmapPage({ p, releases }: { p: Project; releases: Release[] }) {
  const states = releases.map((r) => releaseState(r, p));
  const [picked, setPicked] = useState<string | null>(() => releases.find((_, i) => states[i]?.label !== "Shipped")?.id ?? releases[0]?.id ?? null);

  const readyCount = states.filter((s) => s.met === s.total).length;
  const next = nextRelease(releases, TODAY);
  const openCriteria = states.reduce((a, s) => a + (s.total - s.met), 0);

  return (
    <div style={{ padding: "16px 20px 30px" }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <Kpi label="Releases go-live ready" value={`${readyCount}/${releases.length}`} sub="all criteria met" color={readyCount === releases.length ? C.green : C.amber} />
        <Kpi label="Next release" value={next?.id ?? "—"} sub={next ? `${next.name} · ${MONTHS[next.month]}` : "none scheduled"} color={C.indigoHi} />
        <Kpi label="Open go-live criteria" value={openCriteria} sub="across all releases" color={openCriteria > 0 ? C.amber : C.green} />
      </div>

      <SectionCard title="Delivery timeline" pad="10px 8px 4px" right={<span style={{ fontSize: 11, color: C.dim }}>◆ release · ● milestone gate · bars = delivery window</span>}>
        <RoadmapTimeline p={p} releases={releases} states={states} onPick={setPicked} picked={picked} />
        <div style={{ display: "flex", gap: 16, padding: "6px 8px 8px", fontSize: 11, color: C.dim, flexWrap: "wrap" }}>
          <span>
            <span style={{ color: C.green }}>◆</span> ready / shipped
          </span>
          <span>
            <span style={{ color: C.amber }}>◆</span> at risk
          </span>
          <span>
            <span style={{ color: C.red }}>◆</span> blocked
          </span>
          <span>
            gate dot: <span style={{ color: C.green }}>●</span> stretch <span style={{ color: C.indigo }}>●</span> base <span style={{ color: C.amber }}>●</span> below{" "}
            <span style={{ color: C.dim }}>●</span> unmeasured
          </span>
        </div>
      </SectionCard>

      {releases.map((r, i) => {
        const st = states[i];
        if (!st) return null;
        const isOpen = picked === r.id;
        const color = releaseToneColor(st.tone);
        return (
          <div key={r.id} style={{ background: C.panel, border: `1px solid ${isOpen ? C.line2 : C.line}`, borderRadius: 8, marginBottom: 10, overflow: "hidden" }}>
            <button
              type="button"
              onClick={() => setPicked(isOpen ? null : r.id)}
              className="vf-row"
              style={{ ...reset, width: "100%", display: "flex", alignItems: "center", gap: 11, padding: "12px 14px", transition: "background .12s" }}
            >
              <span style={{ width: 10, height: 10, background: color, transform: "rotate(45deg)", borderRadius: 2, flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: C.dim, width: 22 }}>{r.id}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 14, color: C.text, display: "block" }}>{r.name}</span>
                <span style={{ fontSize: 11, color: C.dim }}>
                  {MONTHS[r.month]} · {r.milestoneIds.join(", ")}
                </span>
              </span>
              <span style={{ fontSize: 12, color: C.mut, fontVariantNumeric: "tabular-nums" }}>
                {st.met}/{st.total} criteria
              </span>
              <Chip tone={st.label === "Ready" || st.label === "Shipped" ? "good" : st.label === "Blocked" ? "bad" : "warn"}>{st.label}</Chip>
              <Caret open={isOpen} />
            </button>
            {isOpen && (
              <div style={{ borderTop: `1px solid ${C.line}`, padding: "4px 14px 12px" }}>
                <div style={{ fontSize: 12, color: C.dim, padding: "8px 0 2px" }}>Go-live criteria</div>
                {r.criteria.map((c, ci) => {
                  const e = st.evals[ci];
                  if (!e) return null;
                  return (
                    <div key={ci} style={{ display: "flex", gap: 10, padding: "8px 0", borderTop: ci === 0 ? "none" : `1px solid ${C.line}`, alignItems: "flex-start" }}>
                      <span style={{ fontSize: 12, color: e.ok ? C.green : e.pending ? C.amber : C.red, width: 14, flexShrink: 0, marginTop: 1 }}>{e.ok ? "✓" : e.pending ? "◐" : "✗"}</span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: 13, color: e.ok ? C.mut : C.text, display: "block" }}>{c.label}</span>
                        <span style={{ fontSize: 11, color: C.dim }}>{e.sub}</span>
                      </span>
                      <Chip tone={e.ok ? "good" : e.pending ? "warn" : "bad"}>{e.ok ? "Met" : e.pending ? "Pending" : "Not met"}</Chip>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      {releases.length === 0 && <div style={{ fontSize: 13, color: C.dim }}>No releases defined for this project.</div>}
    </div>
  );
}
