import { useEffect, useMemo, useState } from "react";
import { explainRelease, monthLabel, nextRelease, releaseState } from "@valueflow/domain";
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

  const readyCount = states.filter((s) => s.total > 0 && s.met === s.total).length;
  const next = nextRelease(releases, cal);
  const lead = useMemo(() => focusRelease(releases, p, cal), [releases, p, cal]);
  const featured = releases.find((r) => r.id === focusId) ?? releases.find((r) => r.id === picked) ?? lead;
  const featuredState = featured ? releaseState(featured, p, cal) : undefined;
  const featuredBlockers = featured ? releaseBlockers(featured, p, cal) : [];

  useEffect(() => {
    if (!focusId) return;
    const target = releases.find((r) => r.id === focusId);
    if (!target) return;
    setPicked(target.id);
    const frame = requestAnimationFrame(() => {
      const hero = document.getElementById("roadmap-featured");
      hero?.scrollIntoView({ behavior: "smooth", block: "start" });
      (hero as HTMLDivElement | null)?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusId, p.id]);

  const focusHero = () => {
    requestAnimationFrame(() => {
      const hero = document.getElementById("roadmap-featured");
      hero?.scrollIntoView({ behavior: "smooth", block: "start" });
      (hero as HTMLDivElement | null)?.focus({ preventScroll: true });
    });
  };
  const selectRelease = (id: string) => {
    setPicked(id);
    onOpen?.(p.id, "roadmap", id);
    focusHero();
  };

  const openBlocker = (release: Release, blocker: ReturnType<typeof releaseBlockers>[number]) => {
    if (blocker.tab === "roadmap") {
      setPicked(release.id);
      setEditing(release.id);
      return;
    }
    onOpen?.(p.id, blocker.tab, blocker.focusId);
  };
  const openCriteria = states.reduce((a, s) => a + (s.total - s.met), 0);

  return (
    <div style={{ padding: "16px 20px 30px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 14, padding: "9px 12px", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, fontSize: 12 }}>
        <span style={{ color: C.mut }}>Release health</span>
        <span style={{ color: releases.length > 0 && readyCount === releases.length ? C.green : C.amber, fontWeight: 550 }}>{readyCount}/{releases.length} ready</span>
        <span style={{ color: C.line3 }}>·</span>
        <span style={{ color: openCriteria > 0 ? C.amber : C.green }}>{openCriteria} open criteria</span>
        <span style={{ color: C.line3 }}>·</span>
        <span style={{ color: C.dim }}>next {next ? `${next.id} · ${monthLabel(next.month, cal.todayYm)}` : "none scheduled"}</span>
      </div>

      {featured && featuredState && (
        <div id="roadmap-featured" tabIndex={-1} style={{ scrollMarginTop: 64, outline: "none" }}>
        <SectionCard
          title={`${featured.month < cal.todayYm ? "Past target" : featured.id === next?.id ? "Next release" : "Selected release"}: ${featured.id} · ${featured.name}`}
          right={<Chip tone={featuredState.label === "Ready" ? "good" : featuredState.label === "Blocked" ? "bad" : "warn"}>{featuredState.label}</Chip>}
        >
          <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap", marginBottom: 10 }}>
            <span style={{ fontSize: 13, color: C.text2 }}>{monthLabel(featured.month, cal.todayYm)}</span>
            <span style={{ fontSize: 12, color: C.dim }}>{featuredState.met}/{featuredState.total} criteria met</span>
          </div>
          {featuredBlockers.length > 0 ? (
            <div style={{ background: C.inset, border: `1px solid ${C.line}`, borderRadius: 7, padding: "2px 12px" }}>
              <div style={{ fontSize: 12, color: C.mut, padding: "8px 0 5px" }}>Open criteria</div>
              {featuredBlockers.map((b) => (
                <div key={`${featured.id}-${b.index}`} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0", borderTop: `1px solid ${C.line}`, flexWrap: "wrap" }}>
                  <span style={{ color: b.evaluation.pending ? C.amber : C.red, fontSize: 12, width: 14 }}>{b.evaluation.pending ? "◐" : "✗"}</span>
                  <span style={{ flex: "1 1 220px", minWidth: 0 }}>
                    <span style={{ display: "block", color: C.text, fontSize: 13 }}>{b.criterion.label}</span>
                    <span style={{ display: "block", color: C.dim, fontSize: 11, marginTop: 2 }}>{b.evaluation.sub}{b.owner ? ` · owner ${b.owner}` : ""}</span>
                  </span>
                  <button type="button" className="vf-ghost" onClick={() => openBlocker(featured, b)} style={{ ...ghostBtn, minHeight: 36, color: C.indigoHi }}>
                    {b.label} ↗
                  </button>
                </div>
              ))}
            </div>
          ) : featuredState.total === 0 ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: C.amber }}>Configure at least one criterion before this release can be ready.</span>
              <button type="button" className="vf-ghost" onClick={() => setEditing(featured.id)} style={{ ...ghostBtn, minHeight: 36, color: C.indigoHi }}>Configure criteria ↗</button>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: C.green }}>All configured criteria are met. Review deployment separately before treating this as shipped.</div>
          )}
        </SectionCard>
        </div>
      )}

      <details style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, marginBottom: 14 }}>
        <summary style={{ cursor: "pointer", padding: "12px 14px", color: C.text, fontSize: 13, fontWeight: 550 }}>View target timeline</summary>
        <div style={{ borderTop: `1px solid ${C.line}`, padding: "10px 8px 4px" }}>
          <div style={{ fontSize: 11, color: C.dim, margin: "0 8px 6px" }}>◆ release target · ● milestone target</div>
        <RoadmapTimeline p={p} releases={releases} states={states} onPick={selectRelease} picked={picked} cal={cal} />
        <div style={{ display: "flex", gap: 16, padding: "6px 8px 8px", fontSize: 11, color: C.dim, flexWrap: "wrap" }}>
          <span>
            <span style={{ color: C.green }}>◆</span> ready
          </span>
          <span>
            <span style={{ color: C.amber }}>◆</span> at risk
          </span>
          <span>
            <span style={{ color: C.red }}>◆</span> blocked
          </span>
          <span>
            target dot: <span style={{ color: C.green }}>●</span> stretch <span style={{ color: C.indigo }}>●</span> base <span style={{ color: C.amber }}>●</span> below{" "}
            <span style={{ color: C.dim }}>●</span> unmeasured
          </span>
        </div>
        </div>
      </details>
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
          <div key={r.id} id={`roadmap-release-${r.id}`} style={{ background: C.panel, border: `1px solid ${isOpen ? C.line2 : C.line}`, borderRadius: 8, marginBottom: 10, overflow: "hidden", scrollMarginTop: 64 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px 8px 14px", flexWrap: "wrap", transition: "background .12s", background: isOpen ? C.panel2 : "transparent" }}>
              <button type="button" onClick={() => { if (isOpen) setPicked(null); else selectRelease(r.id); }} className="vf-row" aria-expanded={isOpen} style={{ ...reset, display: "flex", alignItems: "center", gap: 11, flex: "1 1 260px", minWidth: 0, padding: "4px 0", textAlign: "left" }}>
              <span style={{ width: 10, height: 10, background: color, transform: "rotate(45deg)", borderRadius: 2, flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: C.dim, width: 22 }}>{r.id}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 14, color: C.text, display: "block" }}>{r.name}</span>
                <span style={{ fontSize: 11, color: C.dim }}>
                  {monthLabel(r.month, cal.todayYm)} · {r.milestoneIds.join(", ")}
                </span>
              </span>
              <Caret open={isOpen} />
              </button>
              <Why e={() => explainRelease(p, r, cal)} style={{ fontSize: 12, color: C.mut, fontVariantNumeric: "tabular-nums" }}>{st.met}/{st.total} criteria</Why>
              <Chip tone={st.label === "Ready" || st.label === "Shipped" ? "good" : st.label === "Blocked" ? "bad" : "warn"}>{st.label}</Chip>
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
                        {!e.ok && r.id !== featured?.id && (() => {
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
