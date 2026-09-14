import { useEffect, useMemo, useState } from "react";
import { GSTATUS_LABEL, explainOpenItems, explainReadiness, govCounts, readiness } from "@valueflow/domain";
import { monthLabel } from "@valueflow/domain";
import type { Calendar, GovernanceItem, Project, ProjectTab, Release } from "@valueflow/domain";
import { GovEditor } from "../editors/GovEditor.tsx";
import { Why } from "../ui/Explain.tsx";
import { Avatar, Caret, Chip, SectionCard, ghostBtn, reset } from "../ui/primitives.tsx";
import { C, GSTATUS_COLOR, TIER_COLOR, govChipTone, readinessColor } from "../theme.ts";

export function GovernancePage({
  p,
  defaultOwner,
  releases,
  cal,
  onOpen,
  focusId,
  onSaveGov,
  onDeleteGov,
}: {
  p: Project;
  defaultOwner: string;
  releases: Release[];
  cal: Calendar;
  onOpen?: (id: string, tab: ProjectTab, focusId?: string) => void;
  focusId?: string | null | undefined;
  onSaveGov: (pid: string, item: GovernanceItem, isNew: boolean) => void | Promise<unknown>;
  onDeleteGov: (pid: string, gid: string) => void | Promise<unknown>;
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

  useEffect(() => {
    if (!focusId) return;
    const item = p.governance.find((g) => g.id === focusId);
    if (!item) return;
    setOpen(item.cat + item.id);
    const frame = requestAnimationFrame(() => {
      const row = document.getElementById(`gov-item-${item.id}`);
      row?.scrollIntoView({ behavior: "smooth", block: "center" });
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
