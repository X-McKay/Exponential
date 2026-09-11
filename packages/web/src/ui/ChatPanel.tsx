import { useEffect, useRef, useState } from "react";
import type { AppState, Project, ProjectTab, Proposal } from "@valueflow/domain";
import { api } from "../api/client.ts";
import { Markdown } from "../editors/RunAgent.tsx";
import { partialField } from "../state/live.ts";
import type { LiveRun } from "../state/live.ts";
import { ProposalList } from "./Proposals.tsx";
import { StepTimeline } from "./RunLive.tsx";
import { Btn, Kbd, Tip, ghostBtn, inpStyle, reset } from "./primitives.tsx";
import { C } from "../theme.ts";

interface Turn {
  role: "user" | "assistant";
  content: string;
  links?: { label: string; proj: string; tab: ProjectTab }[];
  proposalIds?: string[];
  runId?: string;
  error?: boolean;
}

const KEY = "valueflow.ask.transcript";

const load = (): Turn[] => {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Turn[]) : [];
  } catch {
    return [];
  }
};

/**
 * A conversation over the whole workspace. Every answer comes from the same
 * facts the pages show, links to where the evidence lives, and may carry
 * proposals you can accept here. Turns are runs of the built-in "ask" agent.
 */
export function ChatPanel({
  state,
  currentProject,
  onOpen,
  onProposals,
  onDecide,
  onClose,
  live,
}: {
  state: AppState;
  currentProject: string | null;
  /** Live runs, so the answer shows as it streams. */
  live: Record<string, LiveRun>;
  onOpen: (pid: string, tab: ProjectTab) => void;
  /** New proposals arrived: merge them into the store. */
  onProposals: (proposals: Proposal[]) => void;
  onDecide: (id: string, decision: "accept" | "dismiss") => void;
  onClose: () => void;
}) {
  const [turns, setTurns] = useState<Turn[]>(load);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const project: Project | undefined = state.projects.find((p) => p.id === currentProject);

  useEffect(() => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(turns.slice(-20)));
    } catch {
      /* fine */
    }
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [turns]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const send = async () => {
    const q = draft.trim();
    if (!q || busy) return;
    const next: Turn[] = [...turns, { role: "user", content: q }];
    setTurns(next);
    setDraft("");
    setBusy(true);
    try {
      const reply = await api.chat({ messages: next.filter((t) => !t.error).slice(-8).map((t) => ({ role: t.role, content: t.content })), proj: currentProject });
      if (reply.proposals.length) onProposals(reply.proposals);
      setTurns((t) => [...t, { role: "assistant", content: reply.answer, links: reply.links, proposalIds: reply.proposals.map((p) => p.id), runId: reply.runId }]);
    } catch (e) {
      setTurns((t) => [...t, { role: "assistant", content: e instanceof Error ? e.message : String(e), error: true }]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const projectName = (pid: string) => state.projects.find((p) => p.id === pid)?.name ?? pid;

  return (
    <aside
      role="dialog"
      aria-label="Ask the workspace"
      className="vf-modal"
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: 440,
        maxWidth: "100vw",
        background: C.inset,
        borderLeft: `1px solid ${C.line2}`,
        boxShadow: `-16px 0 48px ${C.shadow}`,
        zIndex: 60,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", borderBottom: `1px solid ${C.line}` }}>
        <span style={{ width: 20, height: 20, borderRadius: 6, background: "linear-gradient(135deg,#EEEFF1,#8A8F98)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600, color: C.bg }}>A</span>
        <span style={{ fontSize: 13, fontWeight: 550, letterSpacing: "-0.01em" }}>Ask the workspace</span>
        <span style={{ fontSize: 11, color: C.dim, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{project ? `looking at ${project.name}` : "all projects"}</span>
        {turns.length > 0 && (
          <button type="button" onClick={() => setTurns([])} style={{ ...ghostBtn, height: 24 }}>
            Clear
          </button>
        )}
        <Tip label="Close" keys={["esc"]}>
          <button type="button" onClick={onClose} aria-label="Close" style={{ ...reset, color: C.dim, padding: "0 4px" }}>
            ✕
          </button>
        </Tip>
      </div>
      <div ref={listRef} style={{ flex: 1, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 12 }}>
        {turns.length === 0 && (
          <div style={{ fontSize: 12.5, color: C.mut, lineHeight: 1.6 }}>
            <p style={{ margin: "4px 0 10px" }}>Ask anything about the portfolio. Answers come only from the facts on these pages, with links to the evidence. If a change follows, you get a proposal to accept.</p>
            {["What is blocking the next release across the portfolio?", "Which milestones are closest to clearing a gate?", "What did Audie flag this week, and has anyone acted on it?", "Draft a calendar event for the recall gate decision."].map((q) => (
              <button key={q} type="button" onClick={() => setDraft(q)} style={{ ...ghostBtn, display: "block", width: "100%", justifyContent: "flex-start", height: "auto", padding: "6px 10px", marginBottom: 6, textAlign: "left", whiteSpace: "normal", lineHeight: 1.4 }}>
                {q}
              </button>
            ))}
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} style={{ alignSelf: t.role === "user" ? "flex-end" : "stretch", maxWidth: t.role === "user" ? "85%" : "100%" }}>
            {t.role === "user" ? (
              <div style={{ background: C.accentSoft2, border: `1px solid ${C.accentLine2}`, borderRadius: 10, padding: "8px 11px", fontSize: 13, color: C.text, lineHeight: 1.5 }}>{t.content}</div>
            ) : (
              <div style={{ background: C.panel, border: `1px solid ${t.error ? C.badLine2 : C.line}`, borderRadius: 10, padding: "10px 12px" }}>
                {t.error ? <div style={{ fontSize: 12.5, color: C.redHi }}>{t.content}</div> : <Markdown text={t.content} />}
                {t.links && t.links.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                    {t.links.map((l, li) => (
                      <button key={li} type="button" onClick={() => onOpen(l.proj, l.tab)} className="vf-ghost" style={{ ...ghostBtn, height: 24, color: C.indigoHi }}>
                        {l.label} <span style={{ color: C.dim }}>· {projectName(l.proj)}</span> ↗
                      </button>
                    ))}
                  </div>
                )}
                {t.proposalIds && t.proposalIds.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <ProposalList proposals={state.proposals.filter((p) => t.proposalIds?.includes(p.id))} state={state} asOf={state.asOf} showProject onDecide={onDecide} />
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {busy &&
          (() => {
            const askIds = new Set(state.agents.filter((a) => a.kind === "chat").map((a) => a.id));
            const run = Object.values(live)
              .filter((r) => askIds.has(r.agentId) && r.state === "working")
              .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))[0];
            const answer = run ? partialField(run.text, "answer") : null;
            return (
              <div style={{ background: C.panel, border: `1px solid ${C.accentLine}`, borderRadius: 10, padding: "10px 12px" }}>
                {answer ? (
                  <div className="vf-stream">
                    <Markdown text={answer} />
                    <span className="vf-caret" aria-hidden />
                  </div>
                ) : (
                  <StepTimeline steps={run?.steps ?? []} startedAt={run?.startedAt ?? new Date().toISOString()} working />
                )}
              </div>
            );
          })()}
      </div>
      <div style={{ padding: "10px 14px 12px", borderTop: `1px solid ${C.line}` }}>
        <textarea
          ref={inputRef}
          value={draft}
          placeholder={project ? `Ask about ${project.name} or the whole portfolio…` : "Ask about the portfolio…"}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          style={{ ...inpStyle, height: "auto", minHeight: 60, padding: "8px 10px", resize: "vertical", lineHeight: 1.5 }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
          <span style={{ fontSize: 11, color: C.dim, flex: 1, display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Kbd>↵</Kbd> send · <Kbd>⇧</Kbd>
            <Kbd>↵</Kbd> newline · <Kbd>⌘</Kbd>
            <Kbd>J</Kbd> toggle
          </span>
          <Btn tone="primary" disabled={busy || !draft.trim()} onClick={() => void send()}>
            {busy ? "Asking…" : "Ask"}
          </Btn>
        </div>
      </div>
    </aside>
  );
}
