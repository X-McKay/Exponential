// ================= cost governance =================
//
// Spend is derived from runs (tokens, and dollars when LLM_PRICES names the
// model); budgets are the one fact. The bar shows month-to-date against the
// ceiling, the editor sets ceilings for the workspace, agents, and projects.

import { useState } from "react";
import { budgetLabel, fmtTokens, fmtUsd } from "@valueflow/domain";
import type { Agent, Budget, BudgetLine, BudgetScope, PriceList, Project } from "@valueflow/domain";
import { Btn, Modal, Tip, inpStyle } from "./primitives.tsx";
import { C } from "../theme.ts";

export const budgetColor = (line: Pick<BudgetLine, "state">): string => (line.state === "over" ? C.red : line.state === "warn" ? C.amber : line.state === "ok" ? C.green : C.indigoHi);

/** "$12.40 · 1.2M tokens · 48 runs", or tokens alone when nothing is priced. */
export const spendText = (line: BudgetLine): string => {
  const parts: string[] = [];
  if (line.spend.usd !== null) parts.push(fmtUsd(line.spend.usd));
  parts.push(`${fmtTokens(line.spend.tokens)} tokens`);
  parts.push(`${line.spend.runs} run${line.spend.runs === 1 ? "" : "s"}`);
  if (line.spend.unknown > 0) parts.push(`${line.spend.unknown} unknown`);
  if (line.spend.unpriced > 0 && line.spend.usd !== null) parts.push(`${line.spend.unpriced} unpriced`);
  return parts.join(" · ");
};

/** Month-to-date against the ceiling as a slim bar. */
export function SpendBar({ line, label }: { line: BudgetLine; label: string }) {
  const color = budgetColor(line);
  const used = line.used === null ? null : Math.min(1, line.used);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <span style={{ fontSize: 12, color: C.mut, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 12.5, color: C.text, fontVariantNumeric: "tabular-nums" }}>{spendText(line)}</span>
      {line.budget ? (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flex: "1 1 160px", minWidth: 140 }}>
          <span style={{ flex: 1, height: 5, borderRadius: 4, background: C.field, overflow: "hidden" }}>
            <span style={{ display: "block", height: "100%", width: `${Math.round((used ?? 0) * 100)}%`, background: color, transition: "width .3s" }} />
          </span>
          <span style={{ fontSize: 11.5, color, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
            {Math.round((line.used ?? 0) * 100)}% of {budgetLabel(line.budget)}
            {line.state === "over" ? " · runs paused" : ""}
          </span>
        </span>
      ) : (
        <span style={{ fontSize: 11.5, color: C.dim }}>no budget set</span>
      )}
    </div>
  );
}

interface Row {
  scope: BudgetScope;
  ref: string;
  name: string;
  usd: string;
  tokens: string;
}

const numOrNull = (s: string): number | null => {
  const t = s.trim().replace(/[$,]/g, "");
  if (!t) return null;
  const m = t.match(/^(\d+(?:\.\d+)?)\s*([kKmM])?$/);
  if (!m) return null;
  const n = Number(m[1]);
  const mult = m[2]?.toLowerCase() === "m" ? 1_000_000 : m[2]?.toLowerCase() === "k" ? 1000 : 1;
  return Number.isFinite(n) ? n * mult : null;
};

const fmtIn = (v: number | null, tokens: boolean): string => (v === null ? "" : tokens ? (v >= 1_000_000 ? `${v / 1_000_000}M` : v >= 1000 ? `${v / 1000}k` : String(v)) : String(v));

/** Ceilings per month for the workspace, each agent, and each project; blank means no ceiling. */
export function BudgetEditor({ budgets, agents, projects, prices, onSave, onClose }: { budgets: Budget[]; agents: Agent[]; projects: Project[]; prices: PriceList; onSave: (budgets: Budget[]) => Promise<unknown>; onClose: () => void }) {
  const find = (scope: BudgetScope, ref: string) => budgets.find((b) => b.scope === scope && b.ref === ref);
  const initial: Row[] = [
    { scope: "workspace", ref: "", name: "Whole workspace", usd: fmtIn(find("workspace", "")?.monthlyUsd ?? null, false), tokens: fmtIn(find("workspace", "")?.monthlyTokens ?? null, true) },
    ...agents.map((a): Row => ({ scope: "agent", ref: a.id, name: a.name, usd: fmtIn(find("agent", a.id)?.monthlyUsd ?? null, false), tokens: fmtIn(find("agent", a.id)?.monthlyTokens ?? null, true) })),
    ...projects.map((p): Row => ({ scope: "project", ref: p.id, name: p.name, usd: fmtIn(find("project", p.id)?.monthlyUsd ?? null, false), tokens: fmtIn(find("project", p.id)?.monthlyTokens ?? null, true) })),
  ];
  const [rows, setRows] = useState<Row[]>(initial);
  const priced = Object.keys(prices).length > 0;
  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const submit = async () => {
    if (saving) return;
    setSaving(true); setSaveError(null);
    try { await onSave(rows.map((r) => ({ scope: r.scope, ref: r.ref, monthlyUsd: numOrNull(r.usd), monthlyTokens: r.tokens.trim() ? Math.round(numOrNull(r.tokens) ?? 0) || null : null })).filter((b) => b.monthlyUsd !== null || b.monthlyTokens !== null)); }
    catch (e) { setSaveError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  };
  const group = (scope: BudgetScope) => rows.map((r, i) => [r, i] as const).filter(([r]) => r.scope === scope);
  const section = (title: string, scope: BudgetScope) => (
    <div key={scope} style={{ marginTop: 14 }}>
      <div style={{ fontSize: 11, color: C.dim, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 4 }}>{title}</div>
      {group(scope).map(([r, i]) => (
        <div key={`${r.scope}:${r.ref}`} className="vf-cols" style={{ display: "grid", gridTemplateColumns: "1fr 120px 120px", gap: 8, alignItems: "center", padding: "5px 0", borderTop: `1px solid ${C.line}` }}>
          <span style={{ fontSize: 13, color: C.text2 }}>{r.name}</span>
          <input style={{ ...inpStyle, height: 28 }} value={r.usd} placeholder={priced ? "$ / month" : "$ (needs prices)"} onChange={(e) => set(i, { usd: e.target.value })} aria-label={`${r.name} monthly dollars`} />
          <input style={{ ...inpStyle, height: 28 }} value={r.tokens} placeholder="tokens, e.g. 2M" onChange={(e) => set(i, { tokens: e.target.value })} aria-label={`${r.name} monthly tokens`} />
        </div>
      ))}
    </div>
  );
  return (
    <Modal
      title="Monthly budgets"
      onClose={onClose}
      onSubmit={() => void submit()}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn tone="primary" disabled={saving} onClick={() => void submit()}>
            {saving ? "Saving…" : "Save budgets"}
          </Btn>
        </>
      }
    >
      {saveError && <div role="alert" style={{ color: C.redHi, fontSize: 12, margin: "8px 0" }}>Could not save: {saveError}</div>}
      <div style={{ fontSize: 12, color: C.mut, lineHeight: 1.55, marginTop: 8 }}>
        Soft spending limits apply per calendar month, in dollars or tokens or both; the tighter one counts. Calls reserve estimated input/output capacity before running, then provider usage is reconciled afterward. Unknown usage or pricing holds further budgeted calls, and a zero limit pauses that scope. Spend is derived from every run's token counts
        {priced ? ` and the prices for ${Object.keys(prices).join(", ")}.` : "; set LLM_PRICES (model=in/out USD per million tokens) to see dollars."}
      </div>
      <div className="vf-cols vf-cols-head" style={{ display: "grid", gridTemplateColumns: "1fr 120px 120px", gap: 8, marginTop: 14, fontSize: 10.5, color: C.dim, letterSpacing: "0.05em", textTransform: "uppercase" }}>
        <span />
        <span>USD / month</span>
        <span>Tokens / month</span>
      </div>
      {section("Workspace", "workspace")}
      {section("Agents", "agent")}
      {section("Projects", "project")}
    </Modal>
  );
}

/** A compact cell for the quality table: spend this month with a hair-thin budget bar. */
export function SpendCell({ line, tip }: { line: BudgetLine; tip: string }) {
  const color = budgetColor(line);
  return (
    <Tip label={`${tip}${line.budget ? ` · budget ${budgetLabel(line.budget)}` : ""}`}>
      <span style={{ display: "inline-flex", flexDirection: "column", gap: 3, minWidth: 72 }}>
        <span style={{ fontVariantNumeric: "tabular-nums", color: line.spend.tokens ? C.text2 : C.line3 }}>{line.spend.tokens ? `${line.spend.usd !== null ? `${fmtUsd(line.spend.usd)} · ` : ""}${fmtTokens(line.spend.tokens)}` : "—"}</span>
        {line.budget && (
          <span style={{ height: 3, borderRadius: 2, background: C.field, overflow: "hidden" }}>
            <span style={{ display: "block", height: "100%", width: `${Math.round(Math.min(1, line.used ?? 0) * 100)}%`, background: color }} />
          </span>
        )}
      </span>
    </Tip>
  );
}
