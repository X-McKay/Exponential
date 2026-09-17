import { useEffect, useMemo, useState } from "react";
import { GSTATUS_LABEL, explainOpenItems, explainReadiness, govCounts, readiness, templateDrift } from "@valueflow/domain";
import { monthLabel } from "@valueflow/domain";
import type { Calendar, GovernanceItem, Project, ProjectTab, ProjectTemplate, Proposal, Release, TemplateVersion } from "@valueflow/domain";
import { GovEditor } from "../editors/GovEditor.tsx";
import { Why } from "../ui/Explain.tsx";
import { Avatar, Caret, Chip, SectionCard, Tip, ghostBtn, reset } from "../ui/primitives.tsx";
import { C, GSTATUS_COLOR, TIER_COLOR, govChipTone, prefersReducedMotion, readinessColor } from "../theme.ts";

export function GovernancePage({
  p,
  defaultOwner,
  releases,
  cal,
  onOpen,
  focusId,
  onSaveGov,
  onDeleteGov,
  templates = [],
  templateVersions = [],
  proposals = [],
  onDrift,
  onOpenInbox,
}: {
  p: Project;
  defaultOwner: string;
  releases: Release[];
  cal: Calendar;
  onOpen?: (id: string, tab: ProjectTab, focusId?: string) => void;
  focusId?: string | null | undefined;
  onSaveGov: (pid: string, item: GovernanceItem, isNew: boolean) => void | Promise<unknown>;
  onDeleteGov: (pid: string, gid: string) => void | Promise<unknown>;
  templates?: ProjectTemplate[];
  templateVersions?: TemplateVersion[];
  /** Pending proposals, so the drift view can say what is already waiting in the inbox. */
  proposals?: Proposal[];
  /** Stage backfill proposals for the template the project follows, linking one first when given. */
  onDrift?: (pid: string, template?: string) => Promise<unknown>;
  onOpenInbox?: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [editG, setEditG] = useState<{ item: GovernanceItem | null; category?: string } | null>(null);
  const cats = [...new Set(p.governance.map((g) => g.cat))];
  const readinessPct = readiness(p);
  const counts = govCounts(p);
  const openItems = counts.missing + counts.draft + counts.in_review;
  const linked = useMemo(() => {
    const byId = new Map<string, { item: GovernanceItem; releases: Release[] }>();
    for (const release of releases) {
      for (const criterion of release.criteria) {
        if (criterion.type !== "gov") continue;
        const item = p.governance.find((g) => g.id === criterion.gid);
        if (!item) continue;
        const current = byId.get(item.id);
        if (current) current.releases.push(release);
        else byId.set(item.id, { item, releases: [release] });
      }
    }
    return [...byId.values()].sort((a, b) => {
      const aOpen = a.item.status !== "approved" && a.item.status !== "na";
      const bOpen = b.item.status !== "approved" && b.item.status !== "na";
      const aMonth = a.releases.map((linkedRelease) => linkedRelease.month).sort()[0] ?? "9999-99";
      const bMonth = b.releases.map((linkedRelease) => linkedRelease.month).sort()[0] ?? "9999-99";
      return Number(bOpen) - Number(aOpen) || aMonth.localeCompare(bMonth) || a.item.name.localeCompare(b.item.name);
    });
  }, [p.governance, releases]);
  const linkedIds = useMemo(() => new Set(linked.map((x) => x.item.id)), [linked]);

  const template = p.template ? templates.find((t) => t.id === p.template?.id) : undefined;
  const drift = useMemo(() => (template ? templateDrift(p, template, templateVersions) : null), [p, template, templateVersions]);
  const waiting = useMemo(() => new Set(proposals.filter((x) => x.state === "pending" && x.proj === p.id && x.action.type === "governance_item").map((x) => (x.action.type === "governance_item" ? x.action.name.toLowerCase() : ""))), [proposals, p.id]);
  const [linking, setLinking] = useState<string>("");
  const [driftBusy, setDriftBusy] = useState(false);
  const [showAligned, setShowAligned] = useState(false);
  const stage = async (tid?: string) => {
    if (!onDrift || driftBusy) return;
    setDriftBusy(true);
    try { await onDrift(p.id, tid); } catch { /* the store reports the failure */ } finally { setDriftBusy(false); }
  };

  useEffect(() => {
    if (!focusId) return;
    const item = p.governance.find((g) => g.id === focusId);
    if (!item) return;
    setOpen(item.cat + item.id);
    const frame = requestAnimationFrame(() => {
      const row = document.getElementById(`gov-item-${item.id}`);
      row?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
      (row?.querySelector("button") as HTMLButtonElement | null)?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusId, p.id]);

  const renderItem = (g: GovernanceItem, linkedReleases?: Release[]) => {
    const color = GSTATUS_COLOR[g.status];
    const itemOpen = open === g.cat + g.id;
    const hollow = g.status === "in_review" || g.status === "draft";
    return (
      <div key={g.id} id={`gov-item-${g.id}`} style={{ borderTop: `1px solid ${C.line}`, scrollMarginTop: 24 }}>
        <button
          type="button"
          onClick={() => setOpen(itemOpen ? null : g.cat + g.id)}
          className="vf-row"
          style={{ ...reset, width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: itemOpen ? C.panel2 : "transparent", transition: "background .12s", flexWrap: "wrap", textAlign: "left" }}
          aria-expanded={itemOpen}
        >
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: hollow ? "transparent" : color, border: `2px solid ${color}`, flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: g.status === "na" ? C.dim : C.text, flex: "1 1 190px", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name}</span>
          {linkedReleases && <span style={{ fontSize: 11, color: C.indigoHi, flex: "0 1 auto" }}>{linkedReleases.map((linkedRelease) => `${linkedRelease.id} · ${monthLabel(linkedRelease.month, cal.todayYm)}`).join(" · ")}</span>}
          {g.date && <span style={{ fontSize: 11, color: C.dim, fontVariantNumeric: "tabular-nums" }}>recorded {g.date}</span>}
          <Chip tone={govChipTone(g.status)}>{GSTATUS_LABEL[g.status]}</Chip>
          <Avatar ini={g.owner} size={20} />
          <Caret open={itemOpen} />
        </button>
        {itemOpen && (
          <div style={{ padding: "0 14px 12px 32px" }}>
            <div style={{ fontSize: 13, lineHeight: 1.6, color: C.mut }}>{g.detail}</div>
            {g.link && <div style={{ fontSize: 12, color: C.indigoHi, marginTop: 6 }}>{g.link} ↗</div>}
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
              <span style={{ fontSize: 11, color: C.dim }}>Owner {g.owner || "unassigned"}{g.date ? ` · recorded ${g.date}` : " · no recorded date"}</span>
              {linkedReleases?.map((linkedRelease) => (
                <button key={linkedRelease.id} type="button" onClick={() => onOpen?.(p.id, "roadmap", linkedRelease.id)} className="vf-ghost" style={{ ...ghostBtn, height: 25, color: C.indigoHi }}>Open {linkedRelease.id} ↗</button>
              ))}
              <button type="button" onClick={() => setEditG({ item: g })} className="vf-ghost" style={{ ...ghostBtn, height: 25 }}>Edit item</button>
            </div>
          </div>
        )}
      </div>
    );
  };
  return (
    <div style={{ padding: "16px 20px 30px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 14, padding: "9px 12px", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, fontSize: 12 }}>
        <span style={{ color: C.mut }}>Governance health</span>
        <span style={{ color: readinessColor(readinessPct), fontWeight: 550 }}><Why e={() => explainReadiness(p)}>{`${Math.round(readinessPct * 100)}% ready`}</Why></span>
        <span style={{ color: C.line3 }}>·</span>
        <span style={{ color: counts.missing > 0 ? C.red : C.amber }}><Why e={() => explainOpenItems(p)}>{openItems} open</Why></span>
        <span style={{ color: C.line3 }}>·</span>
        <span style={{ color: p.tier ? TIER_COLOR[p.tier] : C.dim }}>{p.tier ? `Tier ${p.tier}` : "Untiered"}</span>
        <span style={{ color: C.dim }}>{p.committee ? `· committee recorded ${p.committee.date}` : "· committee review pending"}</span>
      </div>

      {p.tier === 1 && (
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            background: C.badSoft,
            border: `1px solid ${C.badLine2}`,
            borderRadius: 8,
            padding: "10px 14px",
            marginBottom: 14,
          }}
        >
          <span style={{ color: C.redHi, fontSize: 13 }}>
            Tier 1 controls apply to required items. Release-linked controls below determine configured release readiness; quarterly committee re-review.
          </span>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <button type="button" className="vf-ghost" onClick={() => setEditG({ item: null })} style={{ ...ghostBtn, color: C.indigoHi }}>
          + New item
        </button>
      </div>
      <SectionCard
        title="Required by template"
        pad="0"
        right={
          drift ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: drift.aligned ? C.green : C.amber }}>
                {drift.aligned ? "Every required item is present" : `${drift.missingRequired.length} required item${drift.missingRequired.length === 1 ? "" : "s"} missing`}
                {drift.open.length ? ` · ${drift.open.length} still open` : ""}
              </span>
              {drift.createdFrom !== null && drift.current !== null && drift.current > drift.createdFrom && (
                <Tip label={`The project was created from version ${drift.createdFrom}; the template has since been saved as version ${drift.current}.`}>
                  <Chip tone="warn" dot>template changed since v{drift.createdFrom}</Chip>
                </Tip>
              )}
              {onDrift && !drift.aligned && (
                <button type="button" className="vf-ghost" disabled={driftBusy} onClick={() => void stage()} style={{ ...ghostBtn, height: 24, color: C.indigoHi, opacity: driftBusy ? 0.6 : 1 }}>
                  {driftBusy ? "Staging…" : "Stage missing items for approval"}
                </button>
              )}
            </span>
          ) : undefined
        }
      >
        {!drift ? (
          <div style={{ padding: 14, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: C.dim, flex: "1 1 240px" }}>
              {p.template ? `This project follows the ${p.template.id} template, which no longer exists.` : "This project follows no template, so nothing is checked against a base set of documents and dependencies."}
            </span>
            {onDrift && templates.length > 0 && (
              <>
                <label style={{ fontSize: 12, color: C.mut, display: "inline-flex", alignItems: "center", gap: 6 }}>
                  Follow template
                  <select aria-label="Follow template" value={linking} onChange={(e) => setLinking(e.target.value)} style={{ height: 26, fontSize: 12, color: C.text, background: C.inset, border: `1px solid ${C.line2}`, borderRadius: 6, padding: "0 6px" }}>
                    <option value="">Choose…</option>
                    {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </label>
                <button type="button" className="vf-ghost" disabled={!linking || driftBusy} onClick={() => void stage(linking)} style={{ ...ghostBtn, height: 26, color: C.indigoHi, opacity: !linking || driftBusy ? 0.5 : 1 }}>
                  {driftBusy ? "Checking…" : "Link and check"}
                </button>
              </>
            )}
          </div>
        ) : (
          <>
            <div style={{ padding: "8px 14px", fontSize: 12, color: C.dim, borderBottom: `1px solid ${C.line}` }}>
              {template?.name}{drift.current !== null ? ` v${drift.current}` : ""} · {drift.items.length} item{drift.items.length === 1 ? "" : "s"}, {drift.items.filter((i) => i.required).length} required. Items are matched by name; missing ones can be staged as proposals and appear here once accepted.
              {drift.missingOptional.length ? ` ${drift.missingOptional.length} optional item${drift.missingOptional.length === 1 ? " is" : "s are"} not tracked.` : ""}
            </div>
            {drift.items.filter((i) => showAligned || i.item === null || i.item.status === "missing" || i.item.status === "na").map((i) => {
              const inInbox = i.item === null && waiting.has(i.name.toLowerCase());
              return (
                <div key={`${i.kind}:${i.name}`} className="vf-drift-row" style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", borderTop: `1px solid ${C.line}`, flexWrap: "wrap" }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: i.item ? GSTATUS_COLOR[i.item.status] : "transparent", border: `2px solid ${i.item ? GSTATUS_COLOR[i.item.status] : C.red}` }} />
                  <span style={{ fontSize: 13, color: C.text, flex: "1 1 200px", minWidth: 0, overflowWrap: "anywhere" }}>
                    {i.item ? <button type="button" className="vf-link" onClick={() => setOpen(i.item!.cat + i.item!.id)} style={{ ...reset, color: C.text }}>{i.item.name}</button> : i.name}
                    <span style={{ color: C.dim, fontSize: 11 }}> · {i.cat}{i.required ? "" : " · optional"}</span>
                  </span>
                  {i.item ? <Chip tone={govChipTone(i.item.status)}>{GSTATUS_LABEL[i.item.status]}</Chip> : inInbox ? <Chip tone="accent" dot>Waiting in the inbox</Chip> : <Chip tone="bad" dot>Not on the project</Chip>}
                  {inInbox && onOpenInbox && <button type="button" className="vf-ghost" onClick={onOpenInbox} style={{ ...ghostBtn, height: 22, fontSize: 11 }}>Review ↗</button>}
                </div>
              );
            })}
            <div style={{ padding: "6px 14px", borderTop: `1px solid ${C.line}` }}>
              <button type="button" className="vf-ghost" aria-expanded={showAligned} onClick={() => setShowAligned((v) => !v)} style={{ ...ghostBtn, height: 22, fontSize: 11, border: "none", padding: 0 }}>
                {showAligned ? "Hide items already in place" : `Show ${drift.items.filter((i) => i.item !== null && i.item.status !== "missing" && i.item.status !== "na").length} items already in place`}
              </button>
            </div>
          </>
        )}
      </SectionCard>
      <SectionCard
        title="Release-linked controls"
        right={<span style={{ fontSize: 12, color: C.dim }}>{linked.filter(({ item }) => item.status !== "approved" && item.status !== "na").length} open · {linked.length} required</span>}
        pad="0"
      >
        {linked.length === 0 ? (
          <div style={{ padding: "14px", fontSize: 12, color: C.dim }}>No governance criteria are attached to a release yet.</div>
        ) : (
          linked.map(({ item, releases: itemReleases }) => renderItem(item, itemReleases))
        )}
      </SectionCard>
      {cats.length === 0 && (
        <div style={{ fontSize: 12, color: C.dim, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, padding: "24px 14px", textAlign: "center" }}>
          No governance items yet. Readiness stays at 0% until at least one required item exists.
        </div>
      )}
      {cats.map((cat) => {
        const items = p.governance.filter((g) => g.cat === cat && !linkedIds.has(g.id));
        if (items.length === 0) return null;
        const done = items.filter((g) => g.status === "approved" || g.status === "na").length;
        return (
          <SectionCard
            key={cat}
            title={`${cat} · general register`}
            pad="0"
            right={
              <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 12, color: C.dim }}>
                  {done}/{items.length}
                </span>
                <button type="button" className="vf-ghost" onClick={() => setEditG({ item: null, category: cat })} style={{ ...ghostBtn, height: 24 }}>
                  + Add
                </button>
              </span>
            }
          >
            {items.map((g) => renderItem(g))}
          </SectionCard>
        );
      })}
      {editG && (
        <GovEditor
          project={p}
          item={editG.item}
          category={editG.category}
          defaultOwner={defaultOwner}
          onSave={async (item, isNew) => {
            await onSaveGov(p.id, item, isNew);
            setEditG(null);
          }}
          onDelete={async (gid) => {
            await onDeleteGov(p.id, gid);
            setEditG(null);
            if (open?.endsWith(gid)) setOpen(null);
          }}
          onClose={() => setEditG(null)}
        />
      )}
    </div>
  );
}
