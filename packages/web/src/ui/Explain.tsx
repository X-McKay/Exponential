// ================= provenance on every number =================
//
// Wrap a derived number in <Why e={...}> and it becomes a dotted-underline
// control; clicking it opens the derivation: the value, the rule that made
// it, and the inputs down to the facts, each with "open" and who last
// changed it. The tree comes from the domain (explain.ts); this file only
// draws it.

import { createContext, useContext, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { factTab, relTime, touches } from "@valueflow/domain";
import type { AppState, Explanation, FactRef, ProjectTab, Touch } from "@valueflow/domain";
import { Caret, Modal, ghostBtn, reset } from "./primitives.tsx";
import { C } from "../theme.ts";

interface ExplainContext {
  show: (e: Explanation) => void;
}

const Ctx = createContext<ExplainContext>({ show: () => undefined });

/** A number that can explain itself. Works inside buttons (it is a span with a role) and stops the click from reaching them. */
export function Why({ e, children, style }: { e: Explanation | (() => Explanation); children: ReactNode; style?: CSSProperties }) {
  const ctx = useContext(Ctx);
  const open = () => ctx.show(typeof e === "function" ? e() : e);
  return (
    <span
      role="button"
      tabIndex={0}
      className="vf-why"
      title="Why this number?"
      onClick={(ev) => {
        ev.stopPropagation();
        open();
      }}
      onKeyDown={(ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          ev.stopPropagation();
          open();
        }
      }}
      style={style}
    >
      {children}
    </span>
  );
}

const factLabel = (f: FactRef): string => {
  switch (f.kind) {
    case "milestone":
      return `milestone ${f.mid}`;
    case "metric":
      return `metric ${f.xid} on ${f.mid}`;
    case "governance":
      return `governance item ${f.gid}`;
    case "targets":
      return "project targets";
    case "release":
      return `release ${f.rid}`;
    case "criterion":
      return `criterion ${f.index + 1} of ${f.rid}`;
    case "run":
      return `run ${f.runId}`;
  }
};

/** Every fact under a node, depth first. */
const leaves = (e: Explanation): FactRef[] => (e.fact ? [e.fact] : []).concat(e.inputs.flatMap(leaves));

function TouchLine({ t, asOf }: { t: Touch; asOf: string }) {
  return (
    <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>
      {t.who} · {t.what} · {relTime(t.at, asOf)}
    </div>
  );
}

function Node({ e, depth, state, onOpen, onClose }: { e: Explanation; depth: number; state: AppState; onOpen: (proj: string, tab: ProjectTab) => void; onClose: () => void }) {
  const [open, setOpen] = useState(depth < 1);
  const hasInputs = e.inputs.length > 0;
  const fact = e.fact;
  const touchList = useMemo(() => (fact ? touches(state, fact) : []), [fact, state]);
  const go = () => {
    if (!fact) return;
    if (fact.kind === "run") {
      if (fact.proj) onOpen(fact.proj, "overview");
    } else onOpen(fact.proj, factTab(fact));
    onClose();
  };
  return (
    <div style={{ borderTop: depth === 0 ? "none" : `1px solid ${C.line}` }}>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "7px 0", paddingLeft: depth * 16 }}>
        {hasInputs ? (
          <button type="button" onClick={() => setOpen((v) => !v)} className="vf-row" style={{ ...reset, display: "inline-flex", alignItems: "center", width: 16, height: 18, justifyContent: "center", borderRadius: 4, flexShrink: 0 }} aria-label={open ? "Collapse" : "Expand"}>
            <Caret open={open} />
          </button>
        ) : (
          <span aria-hidden style={{ width: 16, flexShrink: 0, textAlign: "center", color: C.dim2, fontSize: 10, lineHeight: "18px" }}>
            {fact ? "•" : ""}
          </span>
        )}
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, color: fact ? C.text2 : C.text, fontWeight: fact ? 400 : 500 }}>{e.label}</span>
            <span style={{ fontSize: 12.5, color: C.mut, fontVariantNumeric: "tabular-nums" }}>{e.value}</span>
            {fact && (fact.kind !== "run" || fact.proj) && (
              <button type="button" className="vf-ghost" onClick={go} style={{ ...ghostBtn, height: 18, fontSize: 10.5, padding: "0 5px" }}>
                open ↗
              </button>
            )}
          </span>
          {e.rule && <span style={{ display: "block", fontSize: 11.5, color: C.dim, lineHeight: 1.5, marginTop: 1 }}>{e.rule}</span>}
          {fact && <span style={{ display: "block", fontSize: 10.5, color: C.dim2, marginTop: 1 }}>fact · {factLabel(fact)}</span>}
          {touchList.slice(0, 2).map((t, i) => (
            <TouchLine key={i} t={t} asOf={state.asOf} />
          ))}
        </span>
      </div>
      {open && hasInputs && (
        <div>
          {e.inputs.map((child, i) => (
            <Node key={i} e={child} depth={depth + 1} state={state} onOpen={onOpen} onClose={onClose} />
          ))}
        </div>
      )}
    </div>
  );
}

function ExplainModal({ e, state, onOpen, onClose }: { e: Explanation; state: AppState; onOpen: (proj: string, tab: ProjectTab) => void; onClose: () => void }) {
  const facts = useMemo(() => leaves(e), [e]);
  const latest = useMemo(() => facts.flatMap((f) => touches(state, f)).sort((a, b) => (a.at < b.at ? 1 : -1))[0] ?? null, [facts, state]);
  return (
    <Modal title="Where this number comes from" onClose={onClose} width={640}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, color: C.mut }}>{e.label}</span>
        <span style={{ fontSize: 26, fontWeight: 550, letterSpacing: "-0.02em", color: C.text }}>{e.value}</span>
      </div>
      {e.rule && <div style={{ fontSize: 13, color: C.text2, lineHeight: 1.55, marginTop: 6 }}>{e.rule}</div>}
      <div style={{ fontSize: 11.5, color: C.dim, marginTop: 6, display: "flex", gap: 12, flexWrap: "wrap" }}>
        <span>
          {facts.length} fact{facts.length === 1 ? "" : "s"} behind it · derived at read time, never stored
        </span>
        {latest && (
          <span>
            last changed {relTime(latest.at, state.asOf)} by {latest.who}
          </span>
        )}
      </div>
      <div style={{ background: C.deep, border: `1px solid ${C.line}`, borderRadius: 8, padding: "2px 12px", marginTop: 12 }}>
        {e.inputs.length === 0 && <div style={{ fontSize: 12, color: C.dim, padding: "8px 0" }}>Nothing feeds this value.</div>}
        {e.inputs.map((child, i) => (
          <Node key={i} e={child} depth={0} state={state} onOpen={onOpen} onClose={onClose} />
        ))}
      </div>
    </Modal>
  );
}

/** Holds the one open explanation for the whole app and renders its modal. */
export function ExplainProvider({ state, onOpen, children }: { state: AppState; onOpen: (proj: string, tab: ProjectTab) => void; children: ReactNode }) {
  const [current, setCurrent] = useState<Explanation | null>(null);
  const value = useMemo<ExplainContext>(() => ({ show: setCurrent }), []);
  return (
    <Ctx.Provider value={value}>
      {children}
      {current && <ExplainModal e={current} state={state} onOpen={onOpen} onClose={() => setCurrent(null)} />}
    </Ctx.Provider>
  );
}
