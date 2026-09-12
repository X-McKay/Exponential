import { useState } from "react";
import { explainRelease, monthLabel, nextRelease, releaseState } from "@valueflow/domain";
import type { Calendar, Project, Release } from "@valueflow/domain";
import { RoadmapTimeline } from "../charts/RoadmapTimeline.tsx";
import { ReleaseEditor } from "../editors/ReleaseEditor.tsx";
import { Why } from "../ui/Explain.tsx";
import { Caret, Chip, Kpi, SectionCard, Tip, ghostBtn, reset } from "../ui/primitives.tsx";
import { C, releaseToneColor } from "../theme.ts";

export function RoadmapPage({
  p,
  releases,
  cal,
  onSaveRelease,
  onDeleteRelease,
}: {
  p: Project;
  releases: Release[];
  cal: Calendar;
  onSaveRelease: (pid: string, rel: Release, isNew: boolean) => void;
  onDeleteRelease: (pid: string, rid: string) => void;
}) {
  const [editing, setEditing] = useState<"new" | string | null>(null);
  const states = releases.map((r) => releaseState(r, p, cal));
  const [picked, setPicked] = useState<string | null>(() => releases.find((_, i) => states[i]?.label !== "Shipped")?.id ?? releases[0]?.id ?? null);

  const readyCount = states.filter((s) => s.met === s.total).length;
  const next = nextRelease(releases, cal);
  const openCriteria = states.reduce((a, s) => a + (s.total - s.met), 0);

  return (
    <div style={{ padding: "16px 20px 30px" }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <Kpi label="Releases go-live ready" value={`${readyCount}/${releases.length}`} sub="all criteria met" color={readyCount === releases.length ? C.green : C.amber} />
        <Kpi label="Next release" value={next?.id ?? "—"} sub={next ? `${next.name} · ${monthLabel(next.month, cal.todayYm)}` : "none scheduled"} color={C.indigoHi} />
        <Kpi label="Open go-live criteria" value={openCriteria} sub="across all releases" color={openCriteria > 0 ? C.amber : C.green} />
      </div>

      <SectionCard
        title="Delivery timeline"
        pad="10px 8px 4px"
        right={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 11, color: C.dim }}>◆ release · ● milestone gate · bars = delivery window</span>
            <button type="button" className="vf-ghost" onClick={() => setEditing("new")} style={{ ...ghostBtn, height: 24, color: C.indigoHi }}>
              + New release
            </button>
          </span>
        }
      >
        <RoadmapTimeline p={p} releases={releases} states={states} onPick={setPicked} picked={picked} cal={cal} />
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
                  {monthLabel(r.month, cal.todayYm)} · {r.milestoneIds.join(", ")}
                </span>
              </span>
              <Why e={() => explainRelease(p, r, cal)} style={{ fontSize: 12, color: C.mut, fontVariantNumeric: "tabular-nums" }}>
                {st.met}/{st.total} criteria
              </Why>
              <Chip tone={st.label === "Ready" || st.label === "Shipped" ? "good" : st.label === "Blocked" ? "bad" : "warn"}>{st.label}</Chip>
              <Tip label="Edit release">
                <span
                  role="button"
                  tabIndex={0}
                  aria-label="Edit release"
                  className="vf-ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing(r.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      setEditing(r.id);
                    }
                  }}
                  style={{ ...ghostBtn, width: 26, padding: 0, justifyContent: "center", color: C.dim }}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8.5 1.5l2 2L4 10H2V8z" />
                  </svg>
                </span>
              </Tip>
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
      {releases.length === 0 && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "32px 14px", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8 }}>
          <div style={{ fontSize: 13, color: C.text }}>No releases yet</div>
          <div style={{ fontSize: 12, color: C.dim, textAlign: "center", maxWidth: 380 }}>A release ships milestones and goes live only when every criterion is met against live state.</div>
          <button type="button" className="vf-ghost" onClick={() => setEditing("new")} style={{ ...ghostBtn, color: C.indigoHi }}>
            + New release
          </button>
        </div>
      )}
      {editing && (
        <ReleaseEditor
          project={p}
          releases={releases}
          release={editing === "new" ? null : (releases.find((r) => r.id === editing) ?? null)}
          cal={cal}
          onSave={(rel, isNew) => {
            onSaveRelease(p.id, rel, isNew);
            setEditing(null);
            setPicked(rel.id);
          }}
          onDelete={(rid) => {
            onDeleteRelease(p.id, rid);
            setEditing(null);
            if (picked === rid) setPicked(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
