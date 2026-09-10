import { useState } from "react";
import { GOV_STATUSES, GSTATUS_LABEL } from "@valueflow/domain";
import type { GovStatus, GovernanceItem } from "@valueflow/domain";
import { Btn, Lbl, Modal, inpStyle } from "../ui/primitives.tsx";
import { C } from "../theme.ts";

const isGovStatus = (s: string): s is GovStatus => (GOV_STATUSES as readonly string[]).includes(s);

export function GovEditor({ item, onSave, onClose }: { item: GovernanceItem; onSave: (item: GovernanceItem) => void; onClose: () => void }) {
  const [d, setD] = useState<GovernanceItem>({ ...item });
  const set = (patch: Partial<GovernanceItem>) => setD((x) => ({ ...x, ...patch }));
  const dateOk = d.date === null || d.date === "" || /^\d{4}-\d{2}-\d{2}$/.test(d.date);
  return (
    <Modal
      title={`Edit — ${item.name}`}
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn tone="primary" disabled={!dateOk || d.owner.trim().length === 0} onClick={() => onSave({ ...d, owner: d.owner.trim(), date: d.date || null, ...(d.link ? { link: d.link } : {}) })}>
            Save changes
          </Btn>
        </>
      }
    >
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
          <input style={{ ...inpStyle, borderColor: dateOk ? C.line2 : "rgba(229,83,75,.6)" }} value={d.date ?? ""} placeholder="YYYY-MM-DD" onChange={(e) => set({ date: e.target.value })} />
        </div>
      </div>
      <Lbl>Detail / notes</Lbl>
      <textarea style={{ ...inpStyle, minHeight: 84, resize: "vertical", lineHeight: 1.5 }} value={d.detail} onChange={(e) => set({ detail: e.target.value })} />
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
      <div style={{ fontSize: 11.5, color: C.dim, marginTop: 10 }}>Status changes flow through readiness scores, release go-live criteria, and the Glance attention list.</div>
    </Modal>
  );
}
