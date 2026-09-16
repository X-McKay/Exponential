import { useEffect, useRef, useState } from "react";
import { explainRelease, monthLabel, releaseState } from "@valueflow/domain";
import type { Calendar, Project, ProjectTab, Release } from "@valueflow/domain";
import { RoadmapTimeline } from "../charts/RoadmapTimeline.tsx";
import { ReleaseEditor } from "../editors/ReleaseEditor.tsx";
import { focusRelease, releaseBlockers } from "../releaseFocus.ts";
import { Why } from "../ui/Explain.tsx";
import { Caret, Chip, SectionCard, Tip, ghostBtn, reset } from "../ui/primitives.tsx";
import { C, releaseToneColor } from "../theme.ts";

export function RoadmapPage({
  p,
  releases,
  cal,
  onSaveRelease,
  onDeleteRelease,
  onOpen,
  focusId,
}: {
  p: Project;
  releases: Release[];
  cal: Calendar;
  onSaveRelease: (pid: string, rel: Release, isNew: boolean) => void | Promise<unknown>;
  onDeleteRelease: (pid: string, rid: string) => void | Promise<unknown>;
  onOpen?: (id: string, tab: ProjectTab, focusId?: string) => void;
  focusId?: string | null | undefined;
}) {
  const [editing, setEditing] = useState<"new" | string | null>(null);
  const states = releases.map((r) => releaseState(r, p, cal));
  const [picked, setPicked] = useState<string | null>(() => focusRelease(releases, p, cal)?.id ?? releases[0]?.id ?? null);

  // Selecting from the chart also updates the route's focusId. Only a focus
  // that arrives from elsewhere (a deep link, the Glance page) should scroll
  // to the card: moving the chart under the pointer would break its
  // double-click fold.
  const pickedFromChart = useRef(false);
  useEffect(() => {
    if (!focusId) return;
    const target = releases.find((r) => r.id === focusId);
    if (!target) return;
    setPicked(target.id);
    if (pickedFromChart.current) {
      pickedFromChart.current = false;
      return;
    }
    const frame = requestAnimationFrame(() => {
      const row = document.getElementById(`roadmap-release-${target.id}`);
      row?.scrollIntoView({ behavior: "smooth", block: "start" });
      (row as HTMLDivElement | null)?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusId, p.id]);

  const focusReleaseRow = (id: string) => {
    requestAnimationFrame(() => {
      const row = document.getElementById(`roadmap-release-${id}`);
      row?.scrollIntoView({ behavior: "smooth", block: "start" });
      (row as HTMLDivElement | null)?.focus({ preventScroll: true });
    });
  };
  /** Selection from the chart: expand the card below without scrolling to it. */
  const selectFromChart = (id: string) => {
    pickedFromChart.current = focusId !== id;
    setPicked(id);
    onOpen?.(p.id, "roadmap", id);
  };
  const selectRelease = (id: string) => {
    setPicked(id);
    onOpen?.(p.id, "roadmap", id);
    focusReleaseRow(id);
  };

  const openBlocker = (release: Release, blocker: ReturnType<typeof releaseBlockers>[number]) => {
    if (blocker.tab === "roadmap") {
      setPicked(release.id);
      setEditing(release.id);
      return;
    }
    onOpen?.(p.id, blocker.tab, blocker.focusId);
  };

  return (
    <div style={{ padding: "16px 20px 30px" }}>
      <SectionCard title="Roadmap" pad="10px 8px 4px">
        <div style={{ fontSize: 11, color: C.dim, margin: "0 8px 8px" }}>The axis covers only the months with planned work. Each release spans from its first milestone's start to the month it ships. Click a release to open its details below; double-click it, or click its caret, to fold its milestones into the bar.</div>
        <RoadmapTimeline p={p} releases={releases} states={states} onPick={selectFromChart} picked={picked} cal={cal} />
        <div style={{ display: "flex", gap: 16, padding: "6px 8px 8px", fontSize: 11, color: C.dim, flexWrap: "wrap" }}>
          <span>
            release tail: <span style={{ color: C.green }}>◆</span> ready <span style={{ color: C.amber }}>◆</span> at risk <span style={{ color: C.red }}>◆</span> blocked
          </span>
          <span>
            milestone bar: <span style={{ color: C.green }}>▬</span> shipped <span style={{ color: C.indigoHi }}>▬</span> in eval <span style={{ color: C.amber }}>▬</span> in progress{" "}
            <span style={{ color: C.backlog }}>▬</span> backlog
          </span>
          <span>
            target: <span style={{ color: C.green }}>◆</span> stretch <span style={{ color: C.indigo }}>◆</span> base <span style={{ color: C.amber }}>◆</span> below{" "}
            <span style={{ color: C.dim }}>◇</span> unmeasured
          </span>
          <span>hatched: after today</span>
        </div>
      </SectionCard>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <button type="button" className="vf-ghost" onClick={() => setEditing("new")} style={{ ...ghostBtn, height: 26, color: C.indigoHi }}>
          + New release
        </button>
      </div>

      {releases.map((r, i) => {
        const st = states[i];
        if (!st) return null;
        const isOpen = picked === r.id;
        const color = releaseToneColor(st.tone);
        return (
          <div key={r.id} id={`roadmap-release-${r.id}`} tabIndex={-1} style={{ background: C.panel, border: `1px solid ${isOpen ? C.line2 : C.line}`, borderRadius: 8, marginBottom: 10, overflow: "hidden", scrollMarginTop: 64, outline: "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px 8px 14px", flexWrap: "wrap", transition: "background .12s", background: isOpen ? C.panel2 : "transparent" }}>
              <button type="button" onClick={() => { if (isOpen) setPicked(null); else selectRelease(r.id); }} className="vf-row" aria-expanded={isOpen} style={{ ...reset, display: "flex", alignItems: "center", gap: 11, flex: "1 1 260px", minWidth: 0, padding: "4px 0", textAlign: "left" }}>
              <span style={{ width: 10, height: 10, background: color, transform: "rotate(45deg)", borderRadius: 2, flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: C.dim, width: 22 }}>{r.id}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 14, color: C.text, display: "block", overflowWrap: "anywhere" }}>{r.name}</span>
                <span style={{ fontSize: 11, color: C.dim }}>
                  {monthLabel(r.month, cal.todayYm)} · {r.milestoneIds.join(", ")}
                </span>
              </span>
              <Caret open={isOpen} />
              </button>
              <Why e={() => explainRelease(p, r, cal)} style={{ fontSize: 12, color: C.mut, fontVariantNumeric: "tabular-nums" }}>{st.met}/{st.total} criteria</Why>
              <Chip tone={st.label === "Ready" ? "good" : st.label === "Blocked" ? "bad" : "warn"}>{st.label}</Chip>
              <Tip label="Edit release">
                <button type="button" aria-label="Edit release" className="vf-ghost" onClick={() => setEditing(r.id)} style={{ ...ghostBtn, width: 26, padding: 0, justifyContent: "center", color: C.dim }}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8.5 1.5l2 2L4 10H2V8z" />
                  </svg>
                </button>
              </Tip>
            </div>
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
                      <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <Chip tone={e.ok ? "good" : e.pending ? "warn" : "bad"}>{e.ok ? "Met" : e.pending ? "Pending" : "Not met"}</Chip>
                        {!e.ok && (() => {
                          const blocker = releaseBlockers(r, p, cal).find((b) => b.index === ci);
                          return blocker ? <button type="button" className="vf-ghost" onClick={() => openBlocker(r, blocker)} style={{ ...ghostBtn, minHeight: 36, fontSize: 12, color: C.indigoHi }}>{blocker.label} ↗</button> : null;
                        })()}
                      </span>
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
          onSave={async (rel, isNew) => {
            await onSaveRelease(p.id, rel, isNew);
            setEditing(null);
            setPicked(rel.id);
          }}
          onDelete={async (rid) => {
            await onDeleteRelease(p.id, rid);
            setEditing(null);
            if (picked === rid) setPicked(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
