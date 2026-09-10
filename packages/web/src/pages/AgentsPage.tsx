import { useState } from "react";
import { AGENT_KIND_LABEL, AGENT_STATUS_LABEL, RUN_STATE_ICON, agentStats, relTime, runsOf } from "@valueflow/domain";
import { pendingProposals } from "@valueflow/domain";
import type { Agent, AgentRun, LlmInfo, Project, ProjectTab, Proposal } from "@valueflow/domain";
import type { RunAgentInput } from "@valueflow/shared";
import { RunAgentEditor, RunViewer } from "../editors/RunAgent.tsx";
import { ProposalList } from "../ui/Proposals.tsx";
import { Avatar, Caret, Chip, Kpi, SectionCard, Tip, ghostBtn, reset } from "../ui/primitives.tsx";
import { AGENT_STATUS, C, RUN_COLOR } from "../theme.ts";

function AgentAvatar({ a, size = 26 }: { a: Agent; size?: number }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: 8,
        background: a.grad,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.42,
        fontWeight: 600,
        color: "#08090A",
        flexShrink: 0,
        boxShadow: "0 0 10px rgba(255,255,255,.06)",
      }}
    >
      {a.name[0]}
    </span>
  );
}

const shortProjectName = (p: Project | undefined): string => (p ? p.name.split(" ").slice(0, 2).join(" ") : "");

export function AgentsPage({
  agents,
  runs,
  proposals,
  projects,
  asOf,
  llm,
  currentProject,
  onOpen,
  onEdit,
  onRun,
  onDecide,
}: {
  agents: Agent[];
  runs: AgentRun[];
  proposals: Proposal[];
  projects: Project[];
  asOf: string;
  llm: LlmInfo | null;
  currentProject: string | null;
  onOpen: (id: string, tab: ProjectTab) => void;
  onEdit: () => void;
  onRun: (input: RunAgentInput) => void;
  onDecide: (id: string, decision: "accept" | "dismiss") => void;
}) {
  const inbox = pendingProposals({ proposals });
  const [open, setOpen] = useState<string | null>(agents.find((a) => a.id === "audie")?.id ?? agents[0]?.id ?? null);
  const [running, setRunning] = useState<Agent | null>(null);
  const [viewing, setViewing] = useState<AgentRun | null>(null);
  const stats = new Map(agents.map((a) => [a.id, agentStats(a, runs, asOf)]));
  const totalRuns = [...stats.values()].reduce((a, s) => a + s.runs, 0);
  const rates = [...stats.values()].map((s) => s.success).filter((s): s is number => s !== null);
  const avgSuccess = rates.length ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length) : null;
  const workingAgents = agents.filter((a) => stats.get(a.id)?.status === "working");
  const attention = [...stats.values()].reduce((a, s) => a + s.attention, 0);
  const auditors = agents.filter((a) => (stats.get(a.id)?.attention ?? 0) > 0).map((a) => a.name);
  const byId = new Map(projects.map((p) => [p.id, p]));
  const viewingAgent = viewing ? agents.find((a) => a.id === viewing.agentId) : undefined;

  return (
    <div style={{ padding: "16px 20px 30px" }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <Kpi label="Runs · 30d" value={totalRuns} sub={`across ${agents.length} agent${agents.length === 1 ? "" : "s"}`} color={C.indigoHi} />
        <Kpi label="Success rate" value={avgSuccess === null ? "—" : `${avgSuccess}%`} sub="runs that completed" color={avgSuccess === null ? C.dim : C.green} ring={avgSuccess === null ? undefined : avgSuccess / 100} />
        <Kpi
          label="Active now"
          value={workingAgents.length}
          sub={workingAgents.length ? `${workingAgents.map((a) => a.name).join(", ")} ${workingAgents.length === 1 ? "is" : "are"} working` : "all idle"}
          color={workingAgents.length ? C.indigoHi : C.dim}
        />
        <Kpi label="Attention flags · 30d" value={attention} sub={auditors.length ? `from ${auditors.join(", ")}` : "none raised"} color={attention ? C.amber : C.dim} />
        <Kpi label="Proposals to review" value={inbox.length} sub={inbox.length ? "accept to apply, dismiss to discard" : "nothing pending"} color={inbox.length ? C.indigoHi : C.dim} />
      </div>

      {inbox.length > 0 && (
        <SectionCard title="Proposals awaiting a decision" pad="12px 14px">
          <ProposalList proposals={inbox} state={{ projects, agents }} asOf={asOf} showProject onDecide={onDecide} />
        </SectionCard>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: C.dim, flex: 1 }}>
          {llm ? `Agents run against ${llm.model ?? "the configured model"} at ${llm.baseUrl}` : "Agents cannot run: set LLM_BASE_URL to an OpenAI-compatible endpoint"}
        </span>
      </div>

      <SectionCard
        title="Workspace agents"
        pad="0"
        right={
          <button type="button" className="vf-ghost" onClick={onEdit} style={{ ...ghostBtn, height: 24 }}>
            Edit agents
          </button>
        }
      >
        <div style={{ display: "flex", gap: 11, padding: "8px 14px", fontSize: 11, color: C.dim, letterSpacing: "0.06em", textTransform: "uppercase", borderBottom: `1px solid ${C.line}` }}>
          <span style={{ width: 26 }} />
          <span style={{ width: 110, flexShrink: 0 }}>Agent</span>
          <span style={{ flex: 1 }}>Purpose</span>
          <span style={{ width: 104, flexShrink: 0 }}>Status</span>
          <span style={{ width: 56, textAlign: "right", flexShrink: 0 }}>Runs</span>
          <span style={{ width: 62, textAlign: "right", flexShrink: 0 }}>Success</span>
          <span style={{ width: 58, textAlign: "right", flexShrink: 0 }}>Last run</span>
          <span style={{ width: 14 }} />
        </div>
        {agents.map((a) => {
          const s = stats.get(a.id);
          const st = AGENT_STATUS[s?.status ?? "idle"];
          const isOpen = open === a.id;
          const mine = runsOf(a, runs).slice(0, 6);
          return (
            <div key={a.id} style={{ borderBottom: `1px solid ${C.line}` }}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : a.id)}
                className="vf-row"
                style={{ ...reset, width: "100%", display: "flex", alignItems: "center", gap: 11, padding: "11px 14px", background: isOpen ? C.panel2 : "transparent", transition: "background .12s" }}
              >
                <AgentAvatar a={a} />
                <span style={{ width: 110, flexShrink: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 500, color: C.text, display: "block" }}>{a.name}</span>
                  <span style={{ fontSize: 11, color: C.dim }}>{a.model ?? llm?.model ?? AGENT_KIND_LABEL[a.kind].toLowerCase()}</span>
                </span>
                <span style={{ flex: 1, fontSize: 13, color: C.mut, lineHeight: 1.45, minWidth: 0 }}>{a.purpose}</span>
                <span style={{ width: 104, flexShrink: 0, display: "flex", alignItems: "center", gap: 6 }}>
                  <span className={st.pulse ? "vf-pulse" : undefined} style={{ width: 7, height: 7, borderRadius: "50%", background: st.color }} />
                  <span style={{ fontSize: 12, color: st.color }}>{AGENT_STATUS_LABEL[s?.status ?? "idle"]}</span>
                </span>
                <span style={{ width: 56, textAlign: "right", fontSize: 13, color: C.mut, flexShrink: 0 }}>{s?.runs ?? 0}</span>
                <span style={{ width: 62, textAlign: "right", fontSize: 13, color: s?.success !== null && s !== undefined && s.success >= 95 ? C.green : C.mut, flexShrink: 0 }}>
                  {s?.success === null || s === undefined ? "—" : `${s.success}%`}
                </span>
                <span style={{ width: 58, textAlign: "right", fontSize: 12, color: C.dim, flexShrink: 0 }}>{s?.last ? relTime(s.last, asOf) : "never"}</span>
                <span style={{ width: 14, textAlign: "center" }}>
                  <Caret open={isOpen} />
                </span>
              </button>
              {isOpen && (
                <div style={{ padding: "2px 14px 14px 51px" }}>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", margin: "6px 0 10px" }}>
                    {a.caps.map((c) => (
                      <Chip key={c}>{c}</Chip>
                    ))}
                    {a.schedule && <Chip tone="accent">runs {a.schedule}</Chip>}
                    <span style={{ flex: 1 }} />
                    <span style={{ fontSize: 11, color: C.dim }}>Owner</span>
                    <Avatar ini={a.owner} size={18} />
                    <Tip label={llm ? `Brief ${a.name} with a project's live state` : "Set LLM_BASE_URL to enable runs"}>
                      <button type="button" className="vf-ghost" disabled={!llm} onClick={() => setRunning(a)} style={{ ...ghostBtn, color: C.indigoHi, opacity: llm ? 1 : 0.5, marginLeft: 6 }}>
                        Run…
                      </button>
                    </Tip>
                  </div>
                  <div style={{ background: "#0B0C0E", border: `1px solid ${C.line}`, borderRadius: 8, padding: "2px 12px" }}>
                    {mine.length === 0 && <div style={{ fontSize: 12, color: C.dim, padding: "10px 2px" }}>No runs yet.</div>}
                    {mine.map((r, i) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => setViewing(r)}
                        className="vf-row"
                        style={{ ...reset, width: "100%", display: "flex", gap: 10, padding: "9px 2px", borderTop: i === 0 ? "none" : `1px solid ${C.line}`, alignItems: "baseline", transition: "background .12s" }}
                      >
                        <span className={r.state === "working" || r.state === "queued" ? "vf-pulse" : undefined} style={{ fontSize: 11, color: RUN_COLOR[r.state], width: 12, flexShrink: 0 }}>
                          {RUN_STATE_ICON[r.state]}
                        </span>
                        <span style={{ flex: 1, fontSize: 13, color: r.state === "attention" ? C.text : r.state === "failed" ? "#F08A84" : "#C6CAD6", lineHeight: 1.5, minWidth: 0 }}>
                          {r.summary}
                          {proposals.some((p) => p.runId === r.id && p.state === "pending") && (
                            <span style={{ marginLeft: 8 }}>
                              <Chip tone="accent">{proposals.filter((p) => p.runId === r.id && p.state === "pending").length} to review</Chip>
                            </span>
                          )}
                        </span>
                        <span
                          role="link"
                          tabIndex={-1}
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpen(r.proj, r.tab);
                          }}
                          className="vf-link"
                          style={{ fontSize: 11, color: C.dim, flexShrink: 0 }}
                        >
                          {shortProjectName(byId.get(r.proj))}
                        </span>
                        <span style={{ fontSize: 11, color: C.dim, width: 52, textAlign: "right", flexShrink: 0 }}>{relTime(r.startedAt, asOf)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </SectionCard>

      <div style={{ fontSize: 12, color: C.dim, lineHeight: 1.6, maxWidth: 680 }}>
        Every run briefs the agent with the project's live state — targets, gates, governance, releases, synced development activity, and recent events — and
        stores the result. Runs flagged for attention surface on Glance. Audie runs nightly when a model is configured.
      </div>

      {running && (
        <RunAgentEditor
          agent={running}
          projects={projects}
          defaultProject={currentProject}
          onRun={(input) => {
            onRun(input);
            setRunning(null);
          }}
          onClose={() => setRunning(null)}
        />
      )}
      {viewing && (
        <RunViewer
          run={runs.find((r) => r.id === viewing.id) ?? viewing}
          agent={viewingAgent}
          project={byId.get(viewing.proj)}
          asOf={asOf}
          proposals={proposals.filter((p) => p.runId === viewing.id)}
          state={{ projects, agents }}
          onDecide={onDecide}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}
