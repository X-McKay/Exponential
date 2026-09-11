import { useEffect, useMemo, useState } from "react";
import { pendingProposals } from "@valueflow/domain";
import type { AppState, Proposal } from "@valueflow/domain";
import { ProposalList } from "../ui/Proposals.tsx";
import { Caret, Kbd, SectionCard, reset } from "../ui/primitives.tsx";
import { C } from "../theme.ts";

const inEditable = (t: EventTarget | null): boolean => t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);

/**
 * Everything waiting on a person, grouped by project (workspace-level
 * changes first), with keyboard triage: j / k move, a accepts, d dismisses.
 */
export function InboxPage({ state, onDecide }: { state: AppState; onDecide: (id: string, decision: "accept" | "dismiss") => void }) {
  const pending = useMemo(() => pendingProposals(state), [state]);
  const decided = useMemo(() => state.proposals.filter((p) => p.state !== "pending").slice(0, 30), [state]);
  const [selected, setSelected] = useState<string | null>(null);
  const [showDecided, setShowDecided] = useState(false);
  const current = pending.find((p) => p.id === selected) ?? pending[0] ?? null;

  const groups = useMemo(() => {
    const order: (string | null)[] = [null, ...state.projects.map((p) => p.id)];
    return order
      .map((pid) => ({ pid, name: pid === null ? "Workspace" : (state.projects.find((p) => p.id === pid)?.name ?? pid), items: pending.filter((p) => p.proj === pid) }))
      .filter((g) => g.items.length > 0);
  }, [pending, state.projects]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || inEditable(e.target)) return;
      if (document.querySelector("[role=dialog]")) return;
      const idx = current ? pending.findIndex((p) => p.id === current.id) : -1;
      const move = (d: number) => {
        const next = pending[Math.max(0, Math.min(pending.length - 1, idx + d))];
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
          const after = pending[idx + 1] ?? pending[idx - 1] ?? null;
          onDecide(current.id, e.key === "a" ? "accept" : "dismiss");
          setSelected(after?.id ?? null);
          break;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, pending, onDecide]);

  const decide = (id: string, d: "accept" | "dismiss") => {
    const idx = pending.findIndex((p) => p.id === id);
    const after: Proposal | null = pending[idx + 1] ?? pending[idx - 1] ?? null;
    onDecide(id, d);
    setSelected(after?.id ?? null);
  };

  return (
    <div style={{ padding: "16px 20px 30px", maxWidth: 980 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, color: C.mut, flex: 1 }}>
          {pending.length === 0 ? "Nothing is waiting on you." : `${pending.length} proposal${pending.length === 1 ? "" : "s"} waiting. Accepting applies the change through the same paths the editors use; dismissing records the decision.`}
        </span>
        {pending.length > 0 && (
          <span className="vf-hint" style={{ fontSize: 11, color: C.dim, display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Kbd>j</Kbd>
            <Kbd>k</Kbd> move · <Kbd>a</Kbd> accept · <Kbd>d</Kbd> dismiss
          </span>
        )}
      </div>
      {groups.map((g) => (
        <SectionCard key={g.pid ?? "workspace"} title={`${g.name} · ${g.items.length}`} pad="4px 26px 6px">
          <ProposalList proposals={g.items} state={state} asOf={state.asOf} selectedId={current?.id ?? null} onSelect={setSelected} onDecide={decide} />
        </SectionCard>
      ))}
      {pending.length === 0 && (
        <SectionCard pad="28px 14px">
          <div style={{ textAlign: "center", color: C.dim, fontSize: 13, lineHeight: 1.6 }}>
            <div style={{ fontSize: 22, marginBottom: 6 }}>✓</div>
            Inbox zero. Agents add proposals as they run: Audie and Sentry nightly, Coach and Scout weekly, Ask whenever you talk to it.
          </div>
        </SectionCard>
      )}
      {decided.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowDecided((v) => !v)} className="vf-row" style={{ ...reset, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: C.dim, padding: "6px 8px", borderRadius: 6 }}>
            <Caret open={showDecided} /> Recently decided · {decided.length}
          </button>
          {showDecided && (
            <SectionCard pad="4px 26px 6px">
              <ProposalList proposals={decided} state={state} asOf={state.asOf} showProject onDecide={decide} />
            </SectionCard>
          )}
        </div>
      )}
    </div>
  );
}
