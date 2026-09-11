import { useState } from "react";
import { describeAction, relTime } from "@valueflow/domain";
import type { AppState, Proposal } from "@valueflow/domain";
import { Btn, Chip, ListRow, Tip, ghostBtn } from "./primitives.tsx";
import { C } from "../theme.ts";

/** The new instructions a prompt proposal carries, folded by default. */
function PromptPreview({ prompt }: { prompt: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 6 }}>
      <button type="button" className="vf-ghost" onClick={() => setOpen((v) => !v)} style={{ ...ghostBtn, height: 22, fontSize: 11 }}>
        {open ? "Hide" : "Show"} instructions
      </button>
      {open && (
        <pre style={{ margin: "6px 0 0", whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 12, lineHeight: 1.55, color: C.text2, background: C.inset, border: `1px solid ${C.line}`, borderRadius: 6, padding: "8px 10px" }}>
          {prompt ?? "(built-in instructions only)"}
        </pre>
      )}
    </div>
  );
}

/** Proposals with Accept / Dismiss; decided ones show their state. The selected one is the keyboard target. */
export function ProposalList({
  proposals,
  state,
  asOf,
  showProject,
  selectedId,
  onSelect,
  onDecide,
}: {
  proposals: Proposal[];
  state: Pick<AppState, "projects" | "agents"> & Partial<Pick<AppState, "rules">>;
  asOf: string;
  showProject?: boolean;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onDecide: (id: string, decision: "accept" | "dismiss") => void;
}) {
  if (proposals.length === 0) return null;
  const agentName = (id: string) => state.agents.find((a) => a.id === id)?.name ?? id;
  const projectName = (id: string | null) => (id === null ? "workspace" : (state.projects.find((p) => p.id === id)?.name ?? id));
  const ruleText = (id: string) => state.rules?.find((r) => r.id === id)?.text ?? id;
  return (
    <div>
      {proposals.map((p, i) => (
        <div key={p.id} id={`proposal-${p.id}`}>
          <ListRow
            first={i === 0}
            selected={selectedId === p.id}
            onClick={onSelect ? () => onSelect(p.id) : undefined}
            title={describeAction(p.action, state, p.proj)}
            sub={
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span>
                  {agentName(p.agentId)}
                  {showProject ? ` · ${projectName(p.proj)}` : ""} · {relTime(p.createdAt, asOf)}
                </span>
                {p.ruleId && (
                  <Tip label={ruleText(p.ruleId)}>
                    <Chip>rule {p.ruleId.replace("rule-", "#")}</Chip>
                  </Tip>
                )}
              </span>
            }
            below={
              <>
                {p.rationale && (
                  <span style={{ fontSize: 12, color: C.mut, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden", marginTop: 3, lineHeight: 1.5 }} title={p.rationale}>
                    {p.rationale}
                  </span>
                )}
                {p.action.type === "agent_prompt" && <PromptPreview prompt={p.action.prompt} />}
              </>
            }
            right={
              p.state === "pending" ? (
                <>
                  <Btn onClick={() => onDecide(p.id, "dismiss")}>Dismiss</Btn>
                  <Btn tone="primary" onClick={() => onDecide(p.id, "accept")}>
                    Accept
                  </Btn>
                </>
              ) : (
                <Chip tone={p.state === "accepted" ? "good" : "default"} dot>
                  {p.state}
                </Chip>
              )
            }
          />
        </div>
      ))}
    </div>
  );
}
