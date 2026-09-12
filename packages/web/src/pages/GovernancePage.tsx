import { useState } from "react";
import { GSTATUS_LABEL, explainOpenItems, explainReadiness, govCounts, readiness } from "@valueflow/domain";
import type { GovernanceItem, Project } from "@valueflow/domain";
import { GovEditor } from "../editors/GovEditor.tsx";
import { Why } from "../ui/Explain.tsx";
import { Avatar, Caret, Chip, Kpi, SectionCard, ghostBtn, reset } from "../ui/primitives.tsx";
import { C, GSTATUS_COLOR, TIER_COLOR, govChipTone, readinessColor } from "../theme.ts";

export function GovernancePage({
  p,
  defaultOwner,
  onSaveGov,
  onDeleteGov,
}: {
  p: Project;
  defaultOwner: string;
  onSaveGov: (pid: string, item: GovernanceItem, isNew: boolean) => void;
  onDeleteGov: (pid: string, gid: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [editG, setEditG] = useState<{ item: GovernanceItem | null; category?: string } | null>(null);
  const cats = [...new Set(p.governance.map((g) => g.cat))];
  const r = readiness(p);
  const counts = govCounts(p);
  const openItems = counts.missing + counts.draft + counts.in_review;
  return (
    <div style={{ padding: "16px 20px 30px" }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <Kpi label="Governance readiness" value={<Why e={() => explainReadiness(p)}>{`${Math.round(r * 100)}%`}</Why>} sub="approved / required items" color={readinessColor(r)} ring={r} />
        <Kpi
          label="AI risk tier"
          value={p.tier ? `Tier ${p.tier}` : "—"}
          sub={p.committee ? `Committee ${p.committee.date} · ${p.committee.ref}` : "committee review pending"}
          color={p.tier ? TIER_COLOR[p.tier] : C.dim}
        />
        <Kpi label="Open items" value={<Why e={() => explainOpenItems(p)}>{openItems}</Why>} sub={`${counts.missing} missing · ${counts.draft} draft · ${counts.in_review} in review`} color={counts.missing > 0 ? C.red : C.amber} />
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
            Tier 1 controls apply — production release blocked until all items reach Approved. Quarterly committee re-review.
          </span>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <button type="button" className="vf-ghost" onClick={() => setEditG({ item: null })} style={{ ...ghostBtn, color: C.indigoHi }}>
          + New item
        </button>
      </div>
      {cats.length === 0 && (
        <div style={{ fontSize: 12, color: C.dim, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, padding: "24px 14px", textAlign: "center" }}>
          No governance items yet. Readiness stays at 0% until at least one required item exists.
        </div>
      )}
      {cats.map((cat) => {
        const items = p.governance.filter((g) => g.cat === cat);
        const done = items.filter((g) => g.status === "approved" || g.status === "na").length;
        return (
          <SectionCard
            key={cat}
            title={cat}
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
            {items.map((g) => {
              const color = GSTATUS_COLOR[g.status];
              const isOpen = open === cat + g.id;
              const hollow = g.status === "in_review" || g.status === "draft";
              return (
                <div key={g.id} style={{ borderTop: `1px solid ${C.line}` }}>
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : cat + g.id)}
                    className="vf-row"
                    style={{ ...reset, width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: isOpen ? C.panel2 : "transparent", transition: "background .12s" }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: hollow ? "transparent" : color, border: `2px solid ${color}`, flexShrink: 0 }} />
                    <span style={{ fontSize: 13, color: g.status === "na" ? C.dim : C.text, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name}</span>
                    {g.date && <span style={{ fontSize: 11, color: C.dim, fontVariantNumeric: "tabular-nums" }}>{g.date}</span>}
                    <Chip tone={govChipTone(g.status)}>{GSTATUS_LABEL[g.status]}</Chip>
                    <Avatar ini={g.owner} size={20} />
                    <Caret open={isOpen} />
                  </button>
                  {isOpen && (
                    <div style={{ padding: "0 14px 12px 32px" }}>
                      <div style={{ fontSize: 13, lineHeight: 1.6, color: C.mut }}>{g.detail}</div>
                      {g.link && <div style={{ fontSize: 12, color: C.indigoHi, marginTop: 6, cursor: "pointer" }}>{g.link} ↗</div>}
                      <button type="button" onClick={() => setEditG({ item: g })} className="vf-ghost" style={{ ...ghostBtn, marginTop: 8 }}>
                        Edit item
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </SectionCard>
        );
      })}
      {editG && (
        <GovEditor
          project={p}
          item={editG.item}
          category={editG.category}
          defaultOwner={defaultOwner}
          onSave={(item, isNew) => {
            onSaveGov(p.id, item, isNew);
            setEditG(null);
          }}
          onDelete={(gid) => {
            onDeleteGov(p.id, gid);
            setEditG(null);
            if (open?.endsWith(gid)) setOpen(null);
          }}
          onClose={() => setEditG(null)}
        />
      )}
    </div>
  );
}
