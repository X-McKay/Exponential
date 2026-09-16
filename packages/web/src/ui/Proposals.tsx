import { useState } from "react";
import { describeAction, GSTATUS_LABEL, relTime, STATUS_LABEL, TIER_LABEL } from "@valueflow/domain";
import type { AppState, Committee, GovStatus, Impact, MilestoneStatus, Proposal, ProposalAction, RiskTier } from "@valueflow/domain";
import { Btn, Chip, ListRow, Tip, ghostBtn } from "./primitives.tsx";
import { C } from "../theme.ts";

type ProposalState = Pick<AppState, "projects" | "agents"> & Partial<Pick<AppState, "rules" | "releases">>;

/** Produce the live value and the value the proposal would write. */
export function proposalValuePreview(action: ProposalAction, state: ProposalState, proj: string | null): { current: string; proposed: string; detail?: boolean } {
  const project = state.projects.find((p) => p.id === proj);
  switch (action.type) {
    case "governance_status": { const item = project?.governance.find((g) => g.id === action.gid); return { current: item ? GSTATUS_LABEL[item.status] : "Not found", proposed: GSTATUS_LABEL[action.status] }; }
    case "milestone_status": { const item = project?.milestones.find((m) => m.id === action.mid) ?? project?.historicalMilestones?.find((m) => m.id === action.mid); return { current: item ? STATUS_LABEL[item.status] : "Not found", proposed: STATUS_LABEL[action.status] }; }
    case "governance_item": return { current: "Adding a new item", proposed: `${action.name} · ${action.cat} · ${GSTATUS_LABEL[action.status]} · owner ${action.owner}${action.detail ? ` · ${action.detail}` : ""}`, detail: true };
    case "calendar_event": return { current: "Adding a new event", proposed: `${action.date} · ${action.text}${action.sub ? ` · ${action.sub}` : ""}`, detail: true };
    case "targets": return { current: project ? `FTE ${project.targets.fte}% · time ${project.targets.time}%` : "Not found", proposed: `FTE ${action.fte}% · time ${action.time}%` };
    case "agent_prompt": { const agent = state.agents.find((a) => a.id === action.agentId); return { current: agent?.prompt === null ? "Built-in instructions" : agent?.prompt ?? "Not found", proposed: action.prompt === null ? "Built-in instructions" : action.prompt, detail: true }; }
    case "agent_model": { const agent = state.agents.find((a) => a.id === action.agentId); return { current: agent ? (agent.model ?? "Workspace default") : "Not found", proposed: action.model ?? "Workspace default" }; }
    case "project_details": {
      const lines = (src: { description?: string; stage?: string; tier?: RiskTier | null; committee?: Committee | null } | undefined, only: boolean): string => {
        if (!src) return "Not found";
        const out: string[] = [];
        if (!only || action.description !== undefined) out.push(`Description: ${src.description ?? ""}`);
        if (!only || action.stage !== undefined) out.push(`Stage: ${src.stage ?? ""}`);
        if (!only || action.tier !== undefined) out.push(`Risk tier: ${src.tier ? TIER_LABEL[src.tier] : "Untiered"}`);
        if (!only || action.committee !== undefined) out.push(`AI committee: ${src.committee ? `${src.committee.date} · ${src.committee.ref}` : "pending"}`);
        return out.join("\n");
      };
      const merged = project ? { ...project, ...action } : undefined;
      return { current: lines(project, true), proposed: lines(merged, true), detail: true };
    }
    case "team_member": {
      const existing = project?.team.find((t) => t.ini === action.ini);
      return { current: existing ? `${existing.name} · ${existing.role} · ${existing.ini}` : "Adding a new team member", proposed: `${action.name} · ${action.role} · ${action.ini}`, detail: true };
    }
    case "repo": {
      const existing = project?.repos.find((r) => r.name === action.name);
      return { current: existing ? `${existing.name} · ${existing.url}` : "Linking a new repository", proposed: `${action.name} · ${action.url}`, detail: true };
    }
    case "governance_update": {
      const item = project?.governance.find((g) => g.id === action.gid);
      if (!item) return { current: "Not found", proposed: "Not found" };
      const fmt = (g: { status: GovStatus; owner: string; date: string | null; detail: string }): string =>
        [
          ...(action.status !== undefined ? [`Status: ${GSTATUS_LABEL[g.status]}`] : []),
          ...(action.owner !== undefined ? [`Owner: ${g.owner}`] : []),
          ...(action.date !== undefined ? [`Date: ${g.date ?? "none"}`] : []),
          ...(action.detail !== undefined ? [`Detail: ${g.detail || "(empty)"}`] : []),
        ].join("\n");
      return { current: fmt(item), proposed: fmt({ ...item, ...action }), detail: true };
    }
    case "milestone_create":
      return { current: "Adding a new milestone", proposed: `${action.name} · ${STATUS_LABEL[action.status]} · ${action.month} · base FTE ${action.impact.base.fte}% / time ${action.impact.base.time}% · stretch FTE ${action.impact.stretch.fte}% / time ${action.impact.stretch.time}%${action.metrics.length ? `\nMetrics: ${action.metrics.map((x) => `${x.label} (base ≥${x.base}, stretch ≥${x.stretch})`).join("; ")}` : ""}`, detail: true };
    case "milestone_update": {
      const item = project?.milestones.find((m) => m.id === action.mid);
      if (!item) return { current: "Not found", proposed: "Not found" };
      const fmt = (m: { name: string; status: MilestoneStatus; month: string; impact: Impact }): string =>
        [
          ...(action.name !== undefined ? [`Name: ${m.name}`] : []),
          ...(action.status !== undefined ? [`Status: ${STATUS_LABEL[m.status]}`] : []),
          ...(action.month !== undefined ? [`Month: ${m.month}`] : []),
          ...(action.impact !== undefined ? [`Impact: base FTE ${m.impact.base.fte}% / time ${m.impact.base.time}% · stretch FTE ${m.impact.stretch.fte}% / time ${m.impact.stretch.time}%`] : []),
        ].join("\n");
      return { current: fmt(item), proposed: fmt({ ...item, ...action }), detail: true };
    }
    case "release_create":
      return { current: "Adding a new release", proposed: `${action.name} · ${action.month} · ships ${action.milestoneIds.join(", ") || "nothing"}\nCriteria: ${action.criteria.map((c) => c.label).join("; ") || "none"}`, detail: true };
    case "release_update": {
      const rel = state.releases?.[proj ?? ""]?.find((r) => r.id === action.rid);
      if (!rel) return { current: "Not found", proposed: "Not found" };
      const fmt = (r: { name: string; month: string; milestoneIds: string[]; criteria: { label: string }[] }): string =>
        [
          ...(action.name !== undefined ? [`Name: ${r.name}`] : []),
          ...(action.month !== undefined ? [`Month: ${r.month}`] : []),
          ...(action.milestoneIds !== undefined ? [`Ships: ${r.milestoneIds.join(", ") || "nothing"}`] : []),
          ...(action.criteria !== undefined ? [`Criteria: ${r.criteria.map((c) => c.label).join("; ") || "none"}`] : []),
        ].join("\n");
      return { current: fmt(rel), proposed: fmt({ ...rel, ...action }), detail: true };
    }
  }
}

const longValue = (value: string): boolean => value.length > 180 || value.includes("\n");

function ValuePreview({ action, state, proj, showCurrent = true }: { action: ProposalAction; state: ProposalState; proj: string | null; showCurrent?: boolean }) {
  const values = proposalValuePreview(action, state, proj);
  const [open, setOpen] = useState(false);
  const expandable = values.detail || longValue(values.current) || longValue(values.proposed);
  const shown = (value: string) => expandable && !open && longValue(value) ? `${value.slice(0, 180).trimEnd()}…` : value;
  return <div style={{ marginTop: 8, display: "grid", gap: 4, fontSize: 12, lineHeight: 1.6, overflowWrap: "anywhere" }} aria-label={showCurrent ? "Current and proposed values" : "Proposed value"}>
    {showCurrent && <div><span style={{ color: C.dim }}>Current</span><span style={{ color: C.text2, whiteSpace: "pre-wrap" }}> → {shown(values.current)}</span></div>}
    <div><span style={{ color: C.indigoHi }}>Proposed</span><span style={{ color: C.text2, whiteSpace: "pre-wrap" }}> → {shown(values.proposed)}</span></div>
    {expandable && <button type="button" className="vf-ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open} style={{ ...ghostBtn, justifySelf: "start", height: 22, fontSize: 11 }}>{open ? "Hide details" : "Show full comparison"}</button>}
  </div>;
}

function Rationale({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  const clipped = text.length > 220;
  return <div style={{ fontSize: 12, color: C.mut, marginTop: 5, lineHeight: 1.5 }}>{clipped && !open ? `${text.slice(0, 220).trimEnd()}…` : text}{clipped && <button type="button" className="vf-ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open} style={{ ...ghostBtn, marginLeft: 5, height: 21, fontSize: 11 }}>{open ? "Show less" : "Read more"}</button>}</div>;
}

const EXPIRED_MS = 7 * 24 * 60 * 60 * 1000;
const isExpired = (p: Proposal, asOf: string): boolean => p.state === "pending" && Date.parse(asOf) - Date.parse(p.createdAt) > EXPIRED_MS;

/** Proposals with Apply / Dismiss; decided rows describe their recorded outcome. */
export function ProposalList({ proposals, state, asOf, showProject, selectedId, onSelect, onDecide, busyId = null, errors = {}, busyDecision = null, leavingIds }: {
  proposals: Proposal[]; state: ProposalState; asOf: string; showProject?: boolean; selectedId?: string | null; onSelect?: (id: string) => void;
  onDecide: (id: string, decision: "accept" | "dismiss") => void; busyId?: string | null; errors?: Record<string, string>; busyDecision?: "accept" | "dismiss" | null;
  /** Rows that were just decided and are folding away. */
  leavingIds?: ReadonlySet<string>;
}) {
  if (proposals.length === 0) return null;
  const agentName = (id: string) => state.agents.find((a) => a.id === id)?.name ?? id;
  const projectName = (id: string | null) => id === null ? "workspace" : (state.projects.find((p) => p.id === id)?.name ?? id);
  const ruleText = (id: string) => state.rules?.find((r) => r.id === id)?.text ?? id;
  return <div>{proposals.map((p, i) => {
    const expired = isExpired(p, asOf); const busy = busyId !== null;
    const applying = busyId === p.id && busyDecision === "accept"; const dismissing = busyId === p.id && busyDecision === "dismiss";
    const outcome = p.state === "accepted" ? (p.decisionMode === "automatic" ? "Applied automatically" : "Applied") : "Dismissed";
    const title = <>{onSelect ? <button type="button" className="vf-row" onClick={() => onSelect(p.id)} aria-current={selectedId === p.id ? "true" : undefined} style={{ all: "unset", cursor: "pointer", display: "block", width: "100%" }}>{describeAction(p.action, state, p.proj)}</button> : describeAction(p.action, state, p.proj)}</>;
    return <div className={`vf-proposal vf-pop${leavingIds?.has(p.id) ? " vf-leave" : ""}`} key={p.id} id={`proposal-${p.id}`}><ListRow first={i === 0} selected={selectedId === p.id}
      title={title}
      sub={<span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}><span>{agentName(p.agentId)}{showProject ? ` · ${projectName(p.proj)}` : ""} · {relTime(p.createdAt, asOf)}</span>{p.ruleId && <Tip label={ruleText(p.ruleId)}><Chip>rule {p.ruleId.replace("rule-", "#")}</Chip></Tip>}</span>}
      below={<>{p.state === "pending" ? <ValuePreview action={p.action} state={state} proj={p.proj} /> : <ValuePreview action={p.action} state={state} proj={p.proj} showCurrent={false} />}<Rationale text={p.rationale} />{errors[p.id] && <div role="alert" style={{ color: C.redHi, fontSize: 12, marginTop: 6 }}>{errors[p.id]}</div>}</>}
      right={p.state === "pending" ? <><Btn disabled={busy} onClick={() => onDecide(p.id, "dismiss")}>{dismissing ? "Dismissing…" : "Dismiss"}</Btn>{expired ? <Chip tone="warn" dot>Expired</Chip> : <Btn disabled={busy} tone="primary" onClick={() => onDecide(p.id, "accept")}>{applying ? "Applying…" : "Apply change"}</Btn>}</> : <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Chip tone={p.state === "accepted" ? "good" : "default"} dot>{outcome}</Chip>{p.decidedAt && <span style={{ color: C.dim, fontSize: 11 }}>· {relTime(p.decidedAt, asOf)}</span>}{p.decidedBy && <span style={{ color: C.dim, fontSize: 11 }}>· {p.decidedBy}</span>}</span>}
    /></div>;
  })}</div>;
}
