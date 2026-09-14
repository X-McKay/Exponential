import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pendingProposals } from "@valueflow/domain";
import type { AppState } from "@valueflow/domain";
import { ProposalList } from "../ui/Proposals.tsx";
import { Caret, Kbd, SectionCard, reset } from "../ui/primitives.tsx";
import { C } from "../theme.ts";

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
  const saving = useRef(false);

  const groups = useMemo(() => {
    const order = [...new Set([null, ...state.projects.map((p) => p.id), ...pending.map((p) => p.proj)])];
    return order
      .map((pid) => ({ pid, name: pid === null ? "Workspace" : (state.projects.find((p) => p.id === pid)?.name ?? pid), items: pending.filter((p) => p.proj === pid) }))
      .filter((g) => g.items.length > 0);
  }, [pending, state.projects]);

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
  }, [onDecide, ordered]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || saving.current || inEditable(e.target)) return;
      if (document.querySelector("[role=dialog]")) return;
      const idx = current ? ordered.findIndex((p) => p.id === current.id) : -1;
      const move = (d: number) => {
        const next = ordered[Math.max(0, Math.min(ordered.length - 1, idx + d))];
        if (next) {
          setSelected(next.id);
          document.getElementById(`proposal-${next.id}`)?.scrollIntoView({ block: "nearest" });
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
    <div style={{ padding: "16px 20px 30px", maxWidth: 980 }}>
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
      {groups.map((g) => (
        <SectionCard key={g.pid ?? "workspace"} title={`${g.name} · ${g.items.length}`} pad="4px 26px 6px">
          <ProposalList proposals={g.items} state={state} asOf={state.asOf} selectedId={current?.id ?? null} onSelect={setSelected} onDecide={(id, decision) => void decide(id, decision)} busyId={busyId} busyDecision={busyDecision} errors={errors} />
        </SectionCard>
      ))}
      {pending.length === 0 && (
        <SectionCard pad="28px 14px">
          <div style={{ textAlign: "center", color: C.dim, fontSize: 13, lineHeight: 1.6 }}>
            <div style={{ fontSize: 22, marginBottom: 6 }}>✓</div>
            You’re caught up. New proposals will appear here when agents suggest changes.
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
