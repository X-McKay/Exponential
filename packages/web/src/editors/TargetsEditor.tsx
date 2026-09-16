import { useState } from "react";
import type { ImpactPair } from "@valueflow/domain";
import { Btn, Lbl, Modal, inpStyle } from "../ui/primitives.tsx";
import { C } from "../theme.ts";

const num = (v: string): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
const pctOk = (n: number): boolean => Number.isFinite(n) && n >= 0 && n <= 100;

export function TargetsEditor({ targets, onSave, onClose }: { targets: ImpactPair; onSave: (t: ImpactPair) => Promise<unknown>; onClose: () => void }) {
  const [t, setT] = useState<ImpactPair>({ ...targets });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const valid = pctOk(t.fte) && pctOk(t.time);
  const submit = async () => {
    if (saving || !valid) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(t);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      title="Edit value targets"
      onClose={onClose}
      onSubmit={() => void submit()}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn tone="primary" disabled={saving || !valid} onClick={() => void submit()}>
            {saving ? "Saving…" : "Save targets"}
          </Btn>
        </>
      }
    >
      {saveError && <div role="alert" style={{ color: C.redHi, fontSize: 12, margin: "8px 0" }}>Could not save: {saveError}</div>}
      <Lbl>FTE reduction target (%)</Lbl>
      <input type="number" min={0} max={100} style={{ ...inpStyle, borderColor: pctOk(t.fte) ? C.line2 : C.badLine2 }} value={t.fte} onChange={(e) => setT((x) => ({ ...x, fte: num(e.target.value) }))} />
      <Lbl>Time-to-onboard reduction target (%)</Lbl>
      <input type="number" min={0} max={100} style={{ ...inpStyle, borderColor: pctOk(t.time) ? C.line2 : C.badLine2 }} value={t.time} onChange={(e) => setT((x) => ({ ...x, time: num(e.target.value) }))} />
      {!valid && <div style={{ fontSize: 11.5, color: C.redHi, marginTop: 6 }}>Targets are percentages between 0 and 100.</div>}
      <div style={{ fontSize: 12, color: C.dim, marginTop: 10 }}>Targets re-scale the burn-up chart, KPI rings, and portfolio cards immediately.</div>
    </Modal>
  );
}
