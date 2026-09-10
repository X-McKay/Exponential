import { describeAction, relTime } from "@valueflow/domain";
import type { AppState, Proposal } from "@valueflow/domain";
import { Btn, Chip } from "./primitives.tsx";
import { C } from "../theme.ts";

/** Proposals with Accept / Dismiss; decided ones show their state. */
export function ProposalList({
  proposals,
  state,
  asOf,
  showProject,
  onDecide,
}: {
  proposals: Proposal[];
  state: Pick<AppState, "projects" | "agents">;
  asOf: string;
  showProject?: boolean;
  onDecide: (id: string, decision: "accept" | "dismiss") => void;
}) {
  if (proposals.length === 0) return null;
  const agentName = (id: string) => state.agents.find((a) => a.id === id)?.name ?? id;
  const projectName = (id: string) => state.projects.find((p) => p.id === id)?.name ?? id;
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {proposals.map((p) => (
        <div key={p.id} style={{ display: "flex", gap: 12, alignItems: "flex-start", background: "#0E1015", border: `1px solid ${p.state === "pending" ? "rgba(110,123,242,.35)" : C.line}`, borderRadius: 8, padding: "10px 12px" }}>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 13, color: C.text, display: "block" }}>{describeAction(p.action, state, p.proj)}</span>
            {p.rationale && <span style={{ fontSize: 12, color: C.mut, display: "block", marginTop: 3, lineHeight: 1.5 }}>{p.rationale}</span>}
            <span style={{ fontSize: 11, color: C.dim, display: "block", marginTop: 4 }}>
              {agentName(p.agentId)}
              {showProject ? ` · ${projectName(p.proj)}` : ""} · {relTime(p.createdAt, asOf)}
            </span>
          </span>
          {p.state === "pending" ? (
            <span style={{ display: "inline-flex", gap: 6, flexShrink: 0 }}>
              <Btn onClick={() => onDecide(p.id, "dismiss")}>Dismiss</Btn>
              <Btn tone="primary" onClick={() => onDecide(p.id, "accept")}>
                Accept
              </Btn>
            </span>
          ) : (
            <Chip tone={p.state === "accepted" ? "good" : "default"} dot>
              {p.state}
            </Chip>
          )}
        </div>
      ))}
    </div>
  );
}
