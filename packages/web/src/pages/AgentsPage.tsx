import { useState } from "react";
import { AGENT_KIND_LABEL, AGENT_STATUS_LABEL, RUN_STATE_ICON, agentStats, pendingProposals, relTime, runsOf } from "@valueflow/domain";
import type { Agent, AgentRun, LlmInfo, Project, ProjectTab, PromptVersion, Proposal, Rule, RunScore } from "@valueflow/domain";
import type { RuleInput, RunAgentInput } from "@valueflow/shared";
import { RunAgentEditor, RunViewer } from "../editors/RunAgent.tsx";
import type { AgentsSection } from "../router.ts";
import { AGENTS_SECTIONS } from "../router.ts";
import { QualityTable } from "../ui/QualityTable.tsx";
import { RulesPanel } from "../ui/RulesPanel.tsx";
import { Avatar, Caret, Chip, Kbd, Kpi, ListRow, SectionCard, Tip, ghostBtn, reset } from "../ui/primitives.tsx";
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
        boxShadow: `0 0 10px ${C.glow}`,
      }}
    >
      {a.name[0]}
    </span>
  );
}

const shortProjectName = (p: Project | undefined): string => (p ? p.name.split(" ").slice(0, 2).join(" ") : "");
const SECTION_LABEL: Record<AgentsSection, string> = { agents: "Agents", rules: "Standing rules", quality: "Quality" };

export function AgentsPage({
  agents,
  runs,
  proposals,
  scores,
  rules,
  promptVersions,
  projects,
  asOf,
  llm,
  userIni,
  currentProject,
  section,
  busy,
  onSection,
  onOpen,
  onOpenInbox,
  onEdit,
  onRun,
  onDecide,
  onRate,
  onJudge,
  onBenchmark,
  onScout,
  onSetPrompt,
  onSaveRule,
  onDeleteRule,
}: {
  agents: Agent[];
  runs: AgentRun[];
  proposals: Proposal[];
  scores: RunScore[];
  rules: Rule[];
  promptVersions: PromptVersion[];
  projects: Project[];
  asOf: string;
  llm: LlmInfo | null;
  userIni: string;
  currentProject: string | null;
  section: AgentsSection;
  /** The background job in flight, if any: "benchmark" | "scout". */
  busy: "benchmark" | "scout" | null;
  onSection: (s: AgentsSection) => void;
  onOpen: (id: string, tab: ProjectTab) => void;
  onOpenInbox: () => void;
  onEdit: () => void;
  onRun: (input: RunAgentInput) => void;
  onDecide: (id: string, decision: "accept" | "dismiss") => void;
  onRate: (id: string, rating: 1 | -1 | null, note?: string) => void;
  onJudge: (id: string) => Promise<void>;
  onBenchmark: (agentId?: string) => Promise<void>;
  onScout: (agentId?: string) => Promise<void>;
  onSetPrompt: (agentId: string, prompt: string | null) => void;
  onSaveRule: (rule: Rule | null, input: RuleInput) => void;
  onDeleteRule: (id: string) => void;
}) {
  const inbox = pendingProposals({ proposals });
  const [started, setStarted] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(agents.find((a) => a.id === "audie")?.id ?? agents[0]?.id ?? null);
  const [running, setRunning] = useState<Agent | null>(null);
  const [viewing, setViewing] = useState<AgentRun | null>(null);
  // Which button was pressed, so only it reads "Running…"; the job bar carries the progress.
  const jobLabel = busy ? (started ?? (busy === "scout" ? "scout:all" : "all")) : null;
  const bench = (agentId?: string) => {
    setStarted(agentId ?? "all");
    void onBenchmark(agentId).finally(() => setStarted(null));
  };
  const scout = (agentId?: string) => {
    setStarted(`scout:${agentId ?? "all"}`);
    void onScout(agentId).finally(() => setStarted(null));
  };
  const sentry = agents.find((a) => a.kind === "rules");
  const coach = agents.find((a) => a.kind === "tuner");
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
      <div className="vf-kpis">
        <Kpi label="Runs · 30d" value={totalRuns} sub={`across ${agents.length} agent${agents.length === 1 ? "" : "s"}`} color={C.indigoHi} />
        <Kpi label="Success rate" value={avgSuccess === null ? "—" : `${avgSuccess}%`} sub="runs that completed" color={avgSuccess === null ? C.dim : C.green} ring={avgSuccess === null ? undefined : avgSuccess / 100} />
        <Kpi
          label="Active now"
          value={workingAgents.length}
          sub={workingAgents.length ? `${workingAgents.map((a) => a.name).join(", ")} ${workingAgents.length === 1 ? "is" : "are"} working` : "all idle"}
          color={workingAgents.length ? C.indigoHi : C.dim}
        />
        <Kpi label="Attention flags · 30d" value={attention} sub={auditors.length ? `from ${auditors.join(", ")}` : "none raised"} color={attention ? C.amber : C.dim} />
        <Kpi
          label="Waiting on you"
          value={inbox.length}
          sub={
            <button type="button" onClick={onOpenInbox} className="vf-link" style={{ ...reset, color: inbox.length ? C.indigoHi : C.dim }}>
              {inbox.length ? "open the inbox ›" : "inbox is clear"}
            </button>
          }
          color={inbox.length ? C.indigoHi : C.dim}
        />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 4, borderBottom: `1px solid ${C.line}`, marginBottom: 14 }}>
        {AGENTS_SECTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onSection(s)}
            className="vf-tab"
            aria-current={section === s ? "page" : undefined}
            style={{ ...reset, fontSize: 13, padding: "7px 12px", color: section === s ? C.text : C.mut, borderBottom: `2px solid ${section === s ? C.indigo : "transparent"}`, transition: "color .12s, border-color .12s" }}
          >
            {SECTION_LABEL[s]}
            {s === "rules" && rules.length > 0 && <span style={{ color: C.dim, marginLeft: 6, fontSize: 11 }}>{rules.filter((r) => r.enabled).length}</span>}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <span className="vf-hint" style={{ fontSize: 12, color: C.dim }}>
          {llm ? `Agents run against ${llm.model ?? "the configured model"}` : "Agents cannot run: set LLM_BASE_URL to an OpenAI-compatible endpoint"}
        </span>
      </div>

      {section === "rules" && (
        <RulesPanel
          rules={rules}
          proposals={proposals}
          projects={projects}
          defaultOwner={userIni}
          canRun={llm !== null && sentry !== undefined}
          onSave={onSaveRule}
          onDelete={onDeleteRule}
          onRunNow={() => {
            if (!sentry) return;
            for (const p of projects) if (rules.some((r) => r.enabled && (r.proj === null || r.proj === p.id))) onRun({ agentId: sentry.id, proj: p.id });
          }}
        />
      )}

      {section === "agents" && (
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
                    <span style={{ fontSize: 11, color: C.dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{a.model ?? llm?.model ?? AGENT_KIND_LABEL[a.kind].toLowerCase()}</span>
                  </span>
                  <span style={{ flex: 1, fontSize: 13, color: C.mut, lineHeight: 1.45, minWidth: 0 }}>{a.purpose}</span>
                  <span style={{ width: 104, flexShrink: 0, display: "flex", alignItems: "center", gap: 6 }}>
                    <span className={st.pulse ? "vf-pulse" : undefined} style={{ width: 7, height: 7, borderRadius: "50%", background: st.color }} />
                    <span style={{ fontSize: 12, color: st.color }}>
                      {AGENT_STATUS_LABEL[s?.status ?? "idle"]}
                      {s?.status === "scheduled" && a.schedule ? ` · ${a.schedule}` : ""}
                    </span>
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
                      {a.prompt && (
                        <Tip label={a.prompt}>
                          <Chip>custom instructions</Chip>
                        </Tip>
                      )}
                      <span style={{ flex: 1 }} />
                      <span style={{ fontSize: 11, color: C.dim }}>Owner</span>
                      <Avatar ini={a.owner} size={18} />
                      {a.kind === "chat" ? (
                        <span style={{ fontSize: 11, color: C.dim, marginLeft: 6 }}>
                          runs from the Ask panel · <Kbd>⌘</Kbd> <Kbd>J</Kbd>
                        </span>
                      ) : (
                        <Tip label={llm ? (a.kind === "brief" || a.kind === "tuner" || a.kind === "scout" ? `Run ${a.name} over the workspace` : `Brief ${a.name} with a project's live state`) : "Set LLM_BASE_URL to enable runs"}>
                          <button type="button" className="vf-ghost" disabled={!llm} onClick={() => setRunning(a)} style={{ ...ghostBtn, color: C.indigoHi, opacity: llm ? 1 : 0.5, marginLeft: 6 }}>
                            Run…
                          </button>
                        </Tip>
                      )}
                    </div>
                    <div style={{ background: C.deep, border: `1px solid ${C.line}`, borderRadius: 8, padding: "0 12px" }}>
                      {mine.length === 0 && <div style={{ fontSize: 12, color: C.dim, padding: "10px 2px" }}>No runs yet.</div>}
                      {mine.map((r, i) => {
                        const o = scores.find((sc) => sc.runId === r.id && sc.scorer === "judge" && sc.dimension === "overall");
                        const pendingHere = proposals.filter((p) => p.runId === r.id && p.state === "pending").length;
                        return (
                          <ListRow
                            key={r.id}
                            first={i === 0}
                            onClick={() => setViewing(r)}
                            lead={
                              <span className={r.state === "working" || r.state === "queued" ? "vf-pulse" : undefined} style={{ fontSize: 11, color: RUN_COLOR[r.state], width: 12, display: "inline-block" }}>
                                {RUN_STATE_ICON[r.state]}
                              </span>
                            }
                            title={
                              <span style={{ color: r.state === "attention" ? C.text : r.state === "failed" ? C.redHi : C.text2 }}>
                                {r.summary}
                                {pendingHere > 0 && (
                                  <span style={{ marginLeft: 8 }}>
                                    <Chip tone="accent">{pendingHere} to review</Chip>
                                  </span>
                                )}
                              </span>
                            }
                            sub={
                              <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                                {o && (
                                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: o.score >= 0.8 ? C.green : o.score >= 0.6 ? C.amber : C.red, display: "inline-block" }} /> judge {Math.round(o.score * 100)}%
                                  </span>
                                )}
                                {r.benchmark && <Chip>bench</Chip>}
                                <span>{r.proj ? shortProjectName(byId.get(r.proj)) : "workspace"}</span>
                                <span>{relTime(r.startedAt, asOf)}</span>
                              </span>
                            }
                            right={
                              r.proj ? (
                                <button
                                  type="button"
                                  onClick={() => onOpen(r.proj ?? "", r.tab)}
                                  className="vf-ghost"
                                  style={{ ...ghostBtn, height: 22, fontSize: 11 }}
                                >
                                  open ↗
                                </button>
                              ) : undefined
                            }
                          />
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </SectionCard>
      )}

      {section === "quality" && (
        <SectionCard
          title="Quality"
          pad="0"
          right={
            <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
              <span className="vf-hint" style={{ fontSize: 11, color: C.dim }}>
                30-day window · rules on every run · judge on finished runs · benchmark on a fixed case set
              </span>
              <Tip label={llm && llm.models.length >= 2 ? `Benchmark ${llm.models.length} models on every agent` : "Add candidate models with LLM_MODELS to compare"}>
                <button type="button" className="vf-ghost" disabled={busy !== null || !llm || llm.models.length < 2} onClick={() => scout()} style={{ ...ghostBtn, height: 24, opacity: busy !== null || !llm || llm.models.length < 2 ? 0.5 : 1 }}>
                  {jobLabel === "scout:all" ? "Scouting…" : "Scout models"}
                </button>
              </Tip>
              <button type="button" className="vf-ghost" disabled={busy !== null || !llm} onClick={() => bench()} style={{ ...ghostBtn, height: 24, color: C.indigoHi, opacity: busy !== null || !llm ? 0.5 : 1 }}>
                {jobLabel === "all" ? "Running all…" : "Run full benchmark"}
              </button>
            </span>
          }
        >
          <QualityTable
            agents={agents}
            runs={runs}
            scores={scores}
            proposals={proposals}
            versions={promptVersions}
            asOf={asOf}
            llm={llm}
            busy={jobLabel}
            open={detail}
            onToggle={setDetail}
            onBenchmark={bench}
            onScout={scout}
            onSetPrompt={onSetPrompt}
            onTune={(id) => {
              if (coach) onRun({ agentId: coach.id, target: id });
            }}
          />
        </SectionCard>
      )}

      <div style={{ fontSize: 12, color: C.dim, lineHeight: 1.6, maxWidth: 720 }}>
        Every run briefs the agent with live state and stores the result; runs flagged for attention surface on Glance. Audie and Sentry run nightly. Monday writes the weekly brief, Coach proposes prompt changes from measured runs, and Scout compares candidate models, all weekly, all as proposals you decide on in the inbox.
      </div>

      {running && (
        <RunAgentEditor
          agent={running}
          agents={agents}
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
          project={viewing.proj ? byId.get(viewing.proj) : undefined}
          asOf={asOf}
          proposals={proposals.filter((p) => p.runId === viewing.id)}
          scores={scores.filter((s) => s.runId === viewing.id)}
          state={{ projects, agents, rules }}
          canJudge={llm !== null}
          onDecide={onDecide}
          onRate={onRate}
          onJudge={onJudge}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}
