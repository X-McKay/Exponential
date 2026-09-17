import { useMemo, useState } from "react";
import { describeAction, proposalDiff, relTime } from "@valueflow/domain";
import type { AppState, Proposal, ProposalAction, ProposalEvidence } from "@valueflow/domain";
import { Btn, Chip, ListRow, Tip, ghostBtn } from "./primitives.tsx";
import { C } from "../theme.ts";

type ProposalState = Pick<AppState, "projects" | "agents"> & Partial<Pick<AppState, "rules" | "releases" | "templates">>;

const CLIP = 160;
const long = (v: string | null): boolean => v !== null && (v.length > CLIP || v.includes("\n"));
const clip = (v: string, open: boolean): string => (!open && v.length > CLIP ? `${v.slice(0, CLIP).trimEnd()}…` : v);

/**
 * The change as a table: each field the proposal touches, what the record
 * says now, and what accepting writes. Changed rows are lit; a row that would
 * write the same value is shown dim so a reviewer can see it is a no-op.
 */
function DiffView({ action, state, proj, decided }: { action: ProposalAction; state: ProposalState; proj: string | null; /** A decided proposal shows only what it wrote. */ decided: boolean }) {
  const diff = useMemo(() => proposalDiff(action, state, proj), [action, state, proj]);
  const [open, setOpen] = useState(false);
  const expandable = diff.rows.some((r) => long(r.before) || long(r.after));
  const showCurrent = diff.kind === "update" && !decided;
  if (diff.missing) return <div role="note" style={{ marginTop: 8, fontSize: 12, color: C.amber }}>{diff.target} no longer exists, so this change cannot be applied.</div>;
  return (
    <div className="vf-diff" style={{ marginTop: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: C.text2, fontWeight: 500, overflowWrap: "anywhere" }}>{diff.target}</span>
        <Chip tone={diff.kind === "create" ? "accent" : "default"}>{diff.kind === "create" ? "New record" : decided ? "Applied values" : `${diff.rows.filter((r) => r.changed).length} of ${diff.rows.length} field${diff.rows.length === 1 ? "" : "s"} change`}</Chip>
      </div>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12, lineHeight: 1.5 }}>
        <caption style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>{showCurrent ? "Current and proposed values by field" : "Proposed values by field"}</caption>
        <thead>
          <tr style={{ color: C.dim, fontSize: 10.5, letterSpacing: "0.05em", textTransform: "uppercase" }}>
            <th scope="col" style={{ textAlign: "left", fontWeight: 500, padding: "3px 8px 3px 0", width: "22%" }}>Field</th>
            {showCurrent && <th scope="col" style={{ textAlign: "left", fontWeight: 500, padding: "3px 8px" }}>Current</th>}
            <th scope="col" style={{ textAlign: "left", fontWeight: 500, padding: "3px 8px", color: C.indigoHi }}>Proposed</th>
          </tr>
        </thead>
        <tbody>
          {diff.rows.map((r) => (
            <tr key={r.label} data-changed={r.changed ? "1" : "0"} style={{ borderTop: `1px solid ${C.line}`, opacity: r.changed || decided ? 1 : 0.6 }}>
              <th scope="row" style={{ textAlign: "left", fontWeight: 450, color: C.mut, padding: "4px 8px 4px 0", verticalAlign: "top", whiteSpace: "nowrap" }}>{r.label}</th>
              {showCurrent && <td style={{ padding: "4px 8px", color: C.text2, verticalAlign: "top", whiteSpace: "pre-wrap", overflowWrap: "anywhere", textDecoration: r.changed ? "line-through" : "none", textDecorationColor: C.line3 }}>{r.before === null ? "—" : clip(r.before, open)}</td>}
              <td style={{ padding: "4px 8px", color: r.changed ? C.text : C.text2, background: r.changed ? C.accentSoft : "transparent", borderRadius: 4, verticalAlign: "top", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{clip(r.after, open)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {expandable && <button type="button" className="vf-ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open} style={{ ...ghostBtn, marginTop: 4, height: 22, fontSize: 11 }}>{open ? "Show less" : "Show full values"}</button>}
    </div>
  );
}

/** Where the claim came from: the document and the passage, and whether the passage was found in it verbatim. */
function Evidence({ evidence, state }: { evidence: ProposalEvidence; state: ProposalState }) {
  const [open, setOpen] = useState(false);
  const template = evidence.source?.startsWith("template:") ? state.templates?.find((t) => t.id === evidence.source?.slice("template:".length)) : undefined;
  const from = template ? `Required by the ${template.name} template` : evidence.source ? `From ${evidence.source}` : "Source not named";
  const quote = evidence.quote;
  const clipped = quote !== null && quote.length > 220;
  return (
    <figure className="vf-evidence" style={{ margin: "8px 0 0", padding: "6px 10px", borderLeft: `2px solid ${evidence.verified ? C.green : C.amber}`, background: C.deep, borderRadius: "0 6px 6px 0" }}>
      <figcaption style={{ fontSize: 11, color: C.dim, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <span>{from}</span>
        {quote !== null && !template && (
          <Tip label={evidence.verified ? "This passage was found word for word in the document when the change was staged." : "This passage was not found word for word in the document; treat it as the agent's paraphrase and check the source."}>
            <Chip tone={evidence.verified ? "good" : "warn"} dot>{evidence.verified ? "Quoted verbatim" : "Paraphrased"}</Chip>
          </Tip>
        )}
      </figcaption>
      {quote !== null ? (
        <blockquote style={{ margin: "4px 0 0", fontSize: 12, color: C.text2, lineHeight: 1.55, fontStyle: "italic", overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>
          “{clipped && !open ? `${quote.slice(0, 220).trimEnd()}…` : quote}”
          {clipped && <button type="button" className="vf-ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open} style={{ ...ghostBtn, marginLeft: 6, height: 20, fontSize: 11, fontStyle: "normal" }}>{open ? "Less" : "More"}</button>}
        </blockquote>
      ) : (
        <div style={{ fontSize: 12, color: C.dim, marginTop: 2 }}>No passage was quoted; the change rests on the rationale below.</div>
      )}
    </figure>
  );
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
      below={<><DiffView action={p.action} state={state} proj={p.proj} decided={p.state !== "pending"} />{p.evidence && <Evidence evidence={p.evidence} state={state} />}<Rationale text={p.rationale} />{errors[p.id] && <div role="alert" style={{ color: C.redHi, fontSize: 12, marginTop: 6 }}>{errors[p.id]}</div>}</>}
      right={p.state === "pending" ? <><Btn disabled={busy} onClick={() => onDecide(p.id, "dismiss")}>{dismissing ? "Dismissing…" : "Dismiss"}</Btn>{expired ? <Chip tone="warn" dot>Expired</Chip> : <Btn disabled={busy} tone="primary" onClick={() => onDecide(p.id, "accept")}>{applying ? "Applying…" : "Apply change"}</Btn>}</> : <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Chip tone={p.state === "accepted" ? "good" : "default"} dot>{outcome}</Chip>{p.decidedAt && <span style={{ color: C.dim, fontSize: 11 }}>· {relTime(p.decidedAt, asOf)}</span>}{p.decidedBy && <span style={{ color: C.dim, fontSize: 11 }}>· {p.decidedBy}</span>}</span>}
    /></div>;
  })}</div>;
}
