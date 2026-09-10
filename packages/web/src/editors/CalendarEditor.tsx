import { useState } from "react";
import { PROJECT_TABS, slugId } from "@valueflow/domain";
import type { CalendarEvent, Project, ProjectTab } from "@valueflow/domain";
import { Btn, Lbl, Modal, inpStyle } from "../ui/primitives.tsx";
import { C } from "../theme.ts";

const TAB_LABEL: Record<ProjectTab, string> = { overview: "Overview", value: "Value", roadmap: "Roadmap", development: "Development", governance: "Governance" };
const isTab = (s: string): s is ProjectTab => (PROJECT_TABS as readonly string[]).includes(s);

/** A dated item on the calendar: shows on Glance under "Coming up" and can be quoted in the narrative. */
export function CalendarEditor({
  event,
  projects,
  existing,
  today,
  onSave,
  onDelete,
  onClose,
}: {
  event: CalendarEvent | null;
  projects: Project[];
  existing: CalendarEvent[];
  /** YYYY-MM-DD */
  today: string;
  onSave: (ev: CalendarEvent, isNew: boolean) => void;
  onDelete?: (id: string) => void;
  onClose: () => void;
}) {
  const isNew = event === null;
  const [d, setD] = useState<CalendarEvent>(() => event ?? { id: "", date: today, proj: projects[0]?.id ?? "", tab: "overview", text: "", sub: null });
  const [confirmDel, setConfirmDel] = useState(false);
  const set = (patch: Partial<CalendarEvent>) => setD((x) => ({ ...x, ...patch }));
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(d.date);
  const valid = dateOk && d.text.trim() !== "" && d.proj !== "";
  const submit = () => {
    if (!valid) return;
    onSave({ ...d, id: isNew ? slugId(d.text, existing.map((e) => e.id), "event") : d.id, text: d.text.trim(), sub: d.sub?.trim() ? d.sub.trim() : null }, isNew);
  };
  return (
    <Modal
      title={isNew ? "New calendar event" : "Edit calendar event"}
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
            {isNew ? "Add event" : "Save changes"}
          </Btn>
        </>
      }
    >
      <Lbl>What</Lbl>
      <input style={inpStyle} value={d.text} autoFocus={isNew} placeholder="e.g. Pen test window opens" onChange={(e) => set({ text: e.target.value })} />
      <div style={{ display: "grid", gridTemplateColumns: "130px 1fr 1fr", gap: 10 }}>
        <div>
          <Lbl>Date</Lbl>
          <input style={{ ...inpStyle, borderColor: dateOk ? C.line2 : "rgba(229,83,75,.6)" }} value={d.date} placeholder="YYYY-MM-DD" onChange={(e) => set({ date: e.target.value })} />
        </div>
        <div>
          <Lbl>Project</Lbl>
          <select style={inpStyle} value={d.proj} onChange={(e) => set({ proj: e.target.value })}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Lbl>Opens</Lbl>
          <select
            style={inpStyle}
            value={d.tab}
            onChange={(e) => {
              if (isTab(e.target.value)) set({ tab: e.target.value });
            }}
          >
            {PROJECT_TABS.map((t) => (
              <option key={t} value={t}>
                {TAB_LABEL[t]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <Lbl>Detail</Lbl>
      <input style={inpStyle} value={d.sub ?? ""} placeholder="optional context shown under the item" onChange={(e) => set({ sub: e.target.value })} />
      <div style={{ fontSize: 12, color: C.dim, marginTop: 10 }}>Release target months appear on the calendar automatically; only add events that are not releases.</div>
    </Modal>
  );
}
