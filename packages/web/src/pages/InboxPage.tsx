import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RECORD_ACTIONS, pendingProposals } from "@valueflow/domain";
import type { AppState, Proposal } from "@valueflow/domain";
import { ProposalList } from "../ui/Proposals.tsx";
import { Caret, Chip, Kbd, SectionCard, Tip, ghostBtn, reset } from "../ui/primitives.tsx";
import { C } from "../theme.ts";

/** How long a decided row stays on screen while it folds away. */
const LEAVE_MS = 200;

const inEditable = (t: EventTarget | null): boolean => t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);

/**
 * Everything waiting on a person, grouped by project (workspace-level
 * changes first), with keyboard triage: j / k move, a accepts, d dismisses.
 */
export function InboxPage({ state, onDecide }: { state: AppState; onDecide: (id: string, decision: "accept" | "dismiss") => Promise<{ error?: string }> }) {
  const pending = useMemo(() => pendingProposals(state), [state]);
  const decided = useMemo(() => state.proposals.filter((p) => p.state !== "pending").sort((a, b) => (b.decidedAt ?? b.createdAt).localeCompare(a.decidedAt ?? a.createdAt)).slice(0, 30), [state]);
  const [selected, setSelected] = useState<string | null>(null);
  const [showDecided, setShowDecided] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyDecision, setBusyDecision] = useState<"accept" | "dismiss" | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const [batch, setBatch] = useState<{ pid: string | null; decision: "accept" | "dismiss"; done: number; total: number } | null>(null);
  const saving = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  /** Keep a just-decided row visible briefly so it can animate out. */
  const fold = useCallback((id: string) => {
    setLeaving((prev) => new Set(prev).add(id));
    timers.current.push(setTimeout(() => setLeaving((prev) => { const next = new Set(prev); next.delete(id); return next; }), LEAVE_MS));
  }, []);

  // Rows still folding away stay in their group, marked as leaving, until the timer removes them.
  const shown = useMemo(() => {
    const extra = state.proposals.filter((p) => leaving.has(p.id) && p.state !== "pending");
    return [...pending, ...extra].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  }, [pending, state.proposals, leaving]);
  const groups = useMemo(() => {
    const order = [...new Set([null, ...state.projects.map((p) => p.id), ...shown.map((p) => p.proj)])];
    return order
      .map((pid) => {
        const items = shown.filter((p) => p.proj === pid);
        const fromDocuments = items.filter((p) => RECORD_ACTIONS.includes(p.action.type) || state.agents.find((a) => a.id === p.agentId)?.kind === "setup").length;
        return { pid, name: pid === null ? "Workspace" : (state.projects.find((p) => p.id === pid)?.name ?? pid), items, fromDocuments, pending: items.filter((p) => p.state === "pending") };
      })
      .filter((g) => g.items.length > 0);
  }, [shown, state.projects, state.agents]);

  const ordered = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const current = ordered.find((p) => p.id === selected) ?? ordered[0] ?? null;
  const decide = useCallback(async (id: string, decision: "accept" | "dismiss") => {
    if (saving.current) return;
    saving.current = true;
    setBusyId(id);
    setBusyDecision(decision);
    setErrors((previous) => ({ ...previous, [id]: "" }));
    try {
      const result = await onDecide(id, decision);
      if (result.error) {
        setErrors((previous) => ({ ...previous, [id]: result.error! }));
      } else {
        fold(id);
        const idx = ordered.findIndex((p) => p.id === id);
        setSelected((ordered[idx + 1] ?? ordered[idx - 1])?.id ?? null);
      }
    } catch (error) {
      setErrors((previous) => ({ ...previous, [id]: error instanceof Error ? error.message : String(error) }));
    } finally {
      saving.current = false;
      setBusyId(null);
      setBusyDecision(null);
    }
  }, [onDecide, ordered, fold]);

  /** Apply or dismiss every pending proposal in a group, one at a time, stopping at the first refusal. */
  const decideAll = async (items: Proposal[], decision: "accept" | "dismiss", pid: string | null) => {
    if (saving.current || items.length === 0) return;
    saving.current = true;
    setBatch({ pid, decision, done: 0, total: items.length });
    try {
      for (const [i, p] of items.entries()) {
        setBusyId(p.id);
        setBusyDecision(decision);
        const result = await onDecide(p.id, decision);
        if (result.error) {
          setErrors((previous) => ({ ...previous, [p.id]: result.error! }));
          break;
        }
        fold(p.id);
        setBatch((b) => (b ? { ...b, done: i + 1 } : b));
      }
    } finally {
      saving.current = false;
      setBusyId(null);
      setBusyDecision(null);
      setBatch(null);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || saving.current || inEditable(e.target)) return;
      if (document.querySelector("[role=dialog]")) return;
      const idx = current ? ordered.findIndex((p) => p.id === current.id) : -1;
      const move = (d: number) => {
        const next = ordered[Math.max(0, Math.min(ordered.length - 1, idx + d))];
        if (next) {
          setSelected(next.id);
          const row = document.getElementById(`proposal-${next.id}`);
          row?.scrollIntoView({ block: "nearest" });
          // Hand focus to the row's title so a screen reader announces where the selection went.
          row?.querySelector<HTMLElement>("button.vf-row")?.focus({ preventScroll: true });
        }
      };
      switch (e.key) {
        case "j":
        case "ArrowDown":
          e.preventDefault();
          move(1);
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          move(-1);
          break;
        case "a":
        case "d": {
          if (!current) return;
          e.preventDefault();
          if (e.key === "a" && new Date(state.asOf).getTime() - new Date(current.createdAt).getTime() > 7 * 86_400_000) return;
          void decide(current.id, e.key === "a" ? "accept" : "dismiss");
          break;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, ordered, decide, state.asOf]);

  return (
    <div className="vf-container" style={{ padding: "16px 20px 30px", maxWidth: 980 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, color: C.mut, flex: 1 }}>
          {pending.length === 0 ? "Nothing is waiting on you." : `${pending.length} proposal${pending.length === 1 ? "" : "s"} waiting. Review what will change, then apply or dismiss each proposal.`}
        </span>
        {pending.length > 0 && (
          <span className="vf-hint" style={{ fontSize: 11, color: C.dim, display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Kbd>j</Kbd>
            <Kbd>k</Kbd> move · <Kbd>a</Kbd> apply · <Kbd>d</Kbd> dismiss
          </span>
        )}
      </div>
      {groups.map((g) => {
        const expired = (p: Proposal) => new Date(state.asOf).getTime() - new Date(p.createdAt).getTime() > 7 * 86_400_000;
        const applicable = g.pending.filter((p) => !expired(p));
        const running = batch?.pid === g.pid ? batch : null;
        return (
          <SectionCard
            key={g.pid ?? "workspace"}
            title={`${g.name} · ${g.pending.length}`}
            pad="4px 26px 6px"
            right={
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {g.fromDocuments > 0 && <Chip tone="accent">{g.fromDocuments} from documents</Chip>}
                {running ? (
                  <span className="vf-pulse" style={{ fontSize: 12, color: C.indigoHi }}>{running.decision === "accept" ? "Applying" : "Dismissing"} {running.done + 1} of {running.total}…</span>
                ) : g.pending.length > 1 ? (
                  <>
                    <Tip label={`Dismiss all ${g.pending.length} without applying`}>
                      <button type="button" className="vf-ghost" disabled={busyId !== null} onClick={() => void decideAll(g.pending, "dismiss", g.pid)} style={{ ...ghostBtn, height: 24, opacity: busyId !== null ? 0.5 : 1 }}>Dismiss all</button>
                    </Tip>
                    {applicable.length > 1 && (
                      <Tip label={`Apply ${applicable.length} in order; stops at the first change that is refused`}>
                        <button type="button" className="vf-ghost" disabled={busyId !== null} onClick={() => void decideAll(applicable, "accept", g.pid)} style={{ ...ghostBtn, height: 24, color: C.indigoHi, opacity: busyId !== null ? 0.5 : 1 }}>Apply all {applicable.length}</button>
                      </Tip>
                    )}
                  </>
                ) : null}
              </span>
            }
          >
            <ProposalList proposals={g.items} state={state} asOf={state.asOf} selectedId={current?.id ?? null} onSelect={setSelected} onDecide={(id, decision) => void decide(id, decision)} busyId={busyId} busyDecision={busyDecision} errors={errors} leavingIds={leaving} />
          </SectionCard>
        );
      })}
      {pending.length === 0 && shown.length === 0 && (
        <SectionCard pad="28px 14px">
          <div className="vf-pop" style={{ textAlign: "center", color: C.dim, fontSize: 13, lineHeight: 1.6 }}>
            <div style={{ fontSize: 22, marginBottom: 6, color: C.green }}>✓</div>
            You’re caught up. New proposals appear here when agents suggest changes, or when a project is updated from documents.
          </div>
        </SectionCard>
      )}
      {decided.length > 0 && (
        <div>
          <button type="button" aria-expanded={showDecided} onClick={() => setShowDecided((v) => !v)} className="vf-row" style={{ ...reset, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: C.dim, padding: "6px 8px", borderRadius: 6 }}>
            <Caret open={showDecided} /> Recently decided · {decided.length}
          </button>
          {showDecided && (
            <SectionCard pad="4px 26px 6px">
              <ProposalList proposals={decided} state={state} asOf={state.asOf} showProject onDecide={(id, decision) => void decide(id, decision)} busyId={busyId} busyDecision={busyDecision} errors={errors} />
            </SectionCard>
          )}
        </div>
      )}
    </div>
  );
}
