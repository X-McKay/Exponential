import { useState } from "react";
import { GOV_STATUSES, GSTATUS_LABEL, slugId } from "@valueflow/domain";
import type { GovStatus, GovernanceItem, Project } from "@valueflow/domain";
import { Btn, Lbl, Modal, inpStyle } from "../ui/primitives.tsx";
import { C } from "../theme.ts";

const isGovStatus = (s: string): s is GovStatus => (GOV_STATUSES as readonly string[]).includes(s);

const blank = (cat: string, owner: string): GovernanceItem => ({ id: "", cat, name: "", status: "missing", owner, date: null, detail: "" });

/** Create or edit a governance item: what it is, which category it sits in, and where it stands. */
export function GovEditor({
  project,
  item,
  category,
  defaultOwner,
  onSave,
  onDelete,
  onClose,
}: {
  project: Project;
  /** null creates a new item. */
  item: GovernanceItem | null;
  /** Category preset for a new item. */
  category?: string;
  defaultOwner: string;
  onSave: (item: GovernanceItem, isNew: boolean) => void;
  onDelete?: (gid: string) => void;
  onClose: () => void;
}) {
  const isNew = item === null;
  const [d, setD] = useState<GovernanceItem>(() => (item ? { ...item } : blank(category ?? project.governance[0]?.cat ?? "Governance", defaultOwner)));
  const [confirmDel, setConfirmDel] = useState(false);
  const set = (patch: Partial<GovernanceItem>) => setD((x) => ({ ...x, ...patch }));
  const cats = [...new Set(project.governance.map((g) => g.cat))];
  const dateOk = d.date === null || d.date === "" || /^\d{4}-\d{2}-\d{2}$/.test(d.date);
  const valid = dateOk && d.owner.trim().length > 0 && d.name.trim().length > 0 && d.cat.trim().length > 0;
  const submit = () => {
    if (!valid) return;
    const id = isNew ? slugId(d.name, project.governance.map((g) => g.id), "item") : d.id;
    const { link, ...rest } = d;
    onSave({ ...rest, id, cat: d.cat.trim(), name: d.name.trim(), owner: d.owner.trim(), date: d.date || null, ...(link ? { link } : {}) }, isNew);
  };
  return (
    <Modal
      title={isNew ? "New governance item" : `Edit — ${item.name}`}
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          {!isNew && onDelete && (
            <span style={{ marginRight: "auto" }}>
              <Btn tone="danger" onClick={() => (confirmDel ? onDelete(d.id) : setConfirmDel(true))}>
                {confirmDel ? "Confirm delete" : "Delete"}
              </Btn>
            </span>
          )}
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn tone="primary" disabled={!valid} onClick={submit}>
            {isNew ? "Create item" : "Save changes"}
          </Btn>
        </>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 10 }}>
        <div>
          <Lbl>Name</Lbl>
          <input style={inpStyle} value={d.name} autoFocus={isNew} placeholder="e.g. Vendor risk assessment" onChange={(e) => set({ name: e.target.value })} />
        </div>
        <div>
          <Lbl>Category</Lbl>
          <input list="vf-gov-cats" style={inpStyle} value={d.cat} onChange={(e) => set({ cat: e.target.value })} />
          <datalist id="vf-gov-cats">
            {cats.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1.2 }}>
          <Lbl>Status</Lbl>
          <select
            style={inpStyle}
            value={d.status}
            onChange={(e) => {
              if (isGovStatus(e.target.value)) set({ status: e.target.value });
            }}
          >
            {GOV_STATUSES.map((k) => (
              <option key={k} value={k}>
                {GSTATUS_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: 0.6 }}>
          <Lbl>Owner</Lbl>
          <input style={inpStyle} value={d.owner} maxLength={3} onChange={(e) => set({ owner: e.target.value.toUpperCase() })} />
        </div>
        <div style={{ flex: 1 }}>
          <Lbl>Date</Lbl>
          <input style={{ ...inpStyle, borderColor: dateOk ? C.line2 : C.badLine2 }} value={d.date ?? ""} placeholder="YYYY-MM-DD" onChange={(e) => set({ date: e.target.value })} />
        </div>
      </div>
      <Lbl>Detail / notes</Lbl>
      <textarea style={{ ...inpStyle, height: "auto", minHeight: 84, padding: "8px 10px", resize: "vertical", lineHeight: 1.5 }} value={d.detail} onChange={(e) => set({ detail: e.target.value })} />
      <Lbl>Link</Lbl>
      <input
        style={inpStyle}
        value={d.link ?? ""}
        placeholder="confluence/… or airc/…"
        onChange={(e) => {
          const { link: _drop, ...rest } = d;
          void _drop;
          setD(e.target.value ? { ...rest, link: e.target.value } : rest);
        }}
      />
      <div style={{ fontSize: 12, color: C.dim, marginTop: 10 }}>
        Status changes flow through readiness scores, release go-live criteria, and the Glance attention list.
        {!isNew && " Deleting an item leaves any release criterion that references it in place; it resolves to not tracked."}
      </div>
    </Modal>
  );
}
