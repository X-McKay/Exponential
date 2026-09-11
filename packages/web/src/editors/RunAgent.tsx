import { useState } from "react";
import { AGENT_KIND_LABEL, JUDGE_DIMENSIONS, PROJECT_KINDS, PROJECT_TABS, RUN_STATE_ICON, relTime } from "@valueflow/domain";
import type { Agent, AgentRun, AppState, Project, ProjectTab, Proposal, RunScore } from "@valueflow/domain";
import type { RunAgentInput } from "@valueflow/shared";
import { ProposalList } from "../ui/Proposals.tsx";
import { LiveOutput, RunLog, StepTimeline, elapsed, useTicker } from "../ui/RunLive.tsx";
import type { LiveRun } from "../state/live.ts";
import { Btn, Chip, Lbl, Modal, Tip, ghostBtn, inpStyle } from "../ui/primitives.tsx";
import { C, RUN_COLOR } from "../theme.ts";

const TAB_LABEL: Record<ProjectTab, string> = { overview: "Overview", value: "Value", roadmap: "Roadmap", development: "Development", governance: "Governance" };
const isTab = (s: string): s is ProjectTab => (PROJECT_TABS as readonly string[]).includes(s);

const PLACEHOLDER: Record<Agent["kind"], string> = {
  deck: "e.g. 10-slide AIRC pre-read focused on the recall gate and the R1 criteria",
  comms: "e.g. Decision memo on the 88% vs 90% recall threshold for compliance SMEs",
  ideation: "e.g. Options to lift citation accuracy without adding reviewer load",
  audit: "e.g. Focus on audit-trail gaps for rule activations",
  chat: "e.g. What is blocking the next release?",
  rules: "e.g. Only check rules about governance this time",
  brief: "",
  tuner: "",
  scout: "",
  curator: "",
};

/** Start a run: pick the project (and optionally where the result should link) and give the agent an instruction. */
export function RunAgentEditor({
  agent,
  agents,
  projects,
  defaultProject,
  defaultTarget,
  onRun,
  onClose,
}: {
  agent: Agent;
  agents: Agent[];
  projects: Project[];
  defaultProject: string | null;
  defaultTarget?: string | null;
  onRun: (input: RunAgentInput) => void;
  onClose: () => void;
}) {
  const [proj, setProj] = useState(defaultProject ?? projects[0]?.id ?? "");
  const [tab, setTab] = useState<ProjectTab | "">("");
  const [instruction, setInstruction] = useState("");
  const [target, setTarget] = useState(defaultTarget ?? "");
  const perProject = PROJECT_KINDS.includes(agent.kind);
  const targets = agents.filter((a) => (agent.kind === "tuner" ? PROJECT_KINDS.includes(a.kind) || a.kind === "brief" : PROJECT_KINDS.includes(a.kind) && a.kind !== "rules"));
  const valid = perProject ? proj !== "" : true;
  const submit = () => {
    if (!valid) return;
    if (!perProject) {
      onRun({ agentId: agent.id, ...(target ? { target } : {}) });
      return;
    }
    onRun({ agentId: agent.id, proj, ...(tab ? { tab } : {}), ...(instruction.trim() ? { instruction: instruction.trim() } : {}) });
  };
  if (!perProject) {
    const what = agent.kind === "brief" ? "Writes this week's brief for the signed-in user from the whole workspace, stores it as a run, and delivers it if a channel is configured." : agent.kind === "tuner" ? "Reads the agent's weakest measured runs, judge critiques, and ratings, then proposes a change to its extra instructions. Nothing changes until you accept." : "Runs every benchmark case on each candidate model, judges them with the same rubric, and proposes a switch only when the numbers justify it. This can take several minutes.";
    return (
      <Modal
        title={`Run ${agent.name}`}
        onClose={onClose}
        onSubmit={submit}
        footer={
          <>
            <Btn onClick={onClose}>Cancel</Btn>
            <Btn tone="primary" onClick={submit}>
              Run now
            </Btn>
          </>
        }
      >
        <div style={{ fontSize: 12, color: C.mut, lineHeight: 1.55, marginTop: 8 }}>{what}</div>
        {agent.kind !== "brief" && (
          <>
            <Lbl>{agent.kind === "tuner" ? "Agent to tune" : "Agent to scout for"}</Lbl>
            <select style={inpStyle} value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">{agent.kind === "tuner" ? "Every agent with enough measured runs" : "Every benchmarked agent"}</option>
              {targets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </>
        )}
        <div style={{ fontSize: 12, color: C.dim, marginTop: 10 }}>The result is stored as a run and appears in the agent's run list; proposals land in the inbox.</div>
      </Modal>
    );
  }
  return (
    <Modal
      title={`Run ${agent.name}`}
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn tone="primary" disabled={!valid} onClick={submit}>
            Run now
          </Btn>
        </>
      }
    >
      <div style={{ fontSize: 12, color: C.mut, lineHeight: 1.55, marginTop: 8 }}>
        {agent.purpose}. The agent is briefed with the project's live state: targets, milestones and gates, governance, releases, synced development activity, and
        recent events.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 160px", gap: 10 }}>
        <div>
          <Lbl>Project</Lbl>
          <select style={inpStyle} value={proj} onChange={(e) => setProj(e.target.value)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Lbl>Result links to</Lbl>
          <select
            style={inpStyle}
            value={tab}
            onChange={(e) => {
              const v = e.target.value;
              setTab(v === "" ? "" : isTab(v) ? v : "");
            }}
          >
            <option value="">Default for {AGENT_KIND_LABEL[agent.kind].toLowerCase()}</option>
            {PROJECT_TABS.map((t) => (
              <option key={t} value={t}>
                {TAB_LABEL[t]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <Lbl>Instruction (optional)</Lbl>
      <textarea
        style={{ ...inpStyle, height: "auto", minHeight: 76, padding: "8px 10px", resize: "vertical", lineHeight: 1.5 }}
        value={instruction}
        autoFocus
        placeholder={PLACEHOLDER[agent.kind]}
        onChange={(e) => setInstruction(e.target.value)}
      />
      <div style={{ fontSize: 12, color: C.dim, marginTop: 10 }}>Runs take up to a minute. The result is stored and appears in the agent's run list and, if it needs a decision, on Glance.</div>
    </Modal>
  );
}

// ---- output ------------------------------------------------------------------

/** Enough markdown for agent output: headings, bullets, bold, paragraphs. */
export function Markdown({ text }: { text: string }) {
  const inline = (s: string) =>
    s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
      if (part.startsWith("`") && part.endsWith("`"))
        return (
          <code key={i} style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, background: C.inset, padding: "0 4px", borderRadius: 3 }}>
            {part.slice(1, -1)}
          </code>
        );
      return part;
    });
  const blocks: { kind: "h" | "li" | "ol" | "p" | "table"; level?: number; text: string; rows?: string[][] }[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const cells = line.trim().slice(1, -1).split("|").map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
      const last = blocks[blocks.length - 1];
      if (last?.kind === "table" && last.rows) last.rows.push(cells);
      else blocks.push({ kind: "table", text: "", rows: [cells] });
    } else if (h) blocks.push({ kind: "h", level: h[1]?.length ?? 2, text: h[2] ?? "" });
    else if (/^\s*[-*•]\s+/.test(line)) blocks.push({ kind: "li", text: line.replace(/^\s*[-*•]\s+/, "") });
    else if (/^\s*\d+[.)]\s+/.test(line)) blocks.push({ kind: "ol", text: line.replace(/^\s*\d+[.)]\s+/, "") });
    else blocks.push({ kind: "p", text: line });
  }
  return (
    <div style={{ fontSize: 13, lineHeight: 1.6, color: C.text2 }}>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "h":
            return (
              <div key={i} style={{ fontSize: (b.level ?? 2) <= 2 ? 14 : 13, fontWeight: 550, color: C.text, margin: `${i === 0 ? 0 : 14}px 0 4px`, letterSpacing: "-0.01em" }}>
                {inline(b.text)}
              </div>
            );
          case "li":
          case "ol":
            return (
              <div key={i} style={{ display: "flex", gap: 8, padding: "2px 0 2px 6px" }}>
                <span style={{ color: C.dim, flexShrink: 0 }}>{b.kind === "li" ? "•" : "–"}</span>
                <span>{inline(b.text)}</span>
              </div>
            );
          case "p":
            return (
              <p key={i} style={{ margin: "6px 0" }}>
                {inline(b.text)}
              </p>
            );
          case "table":
            return (
              <div key={i} style={{ overflowX: "auto", margin: "8px 0" }}>
                <table style={{ borderCollapse: "collapse", fontSize: 12, whiteSpace: "nowrap" }}>
                  <tbody>
                    {(b.rows ?? []).map((row, ri) => (
                      <tr key={ri} style={{ borderBottom: `1px solid ${C.line}` }}>
                        {row.map((cell, ci) => (
                          <td key={ci} style={{ padding: "4px 10px 4px 0", color: ri === 0 ? C.dim : C.text2, fontWeight: ri === 0 ? 500 : 400 }}>
                            {inline(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </div>
  );
}

export function RunViewer({
  run,
  agent,
  project,
  asOf,
  proposals,
  scores,
  state,
  canJudge,
  live,
  onDecide,
  onRate,
  onJudge,
  onClose,
}: {
  run: AgentRun;
  agent: Agent | undefined;
  project: Project | undefined;
  asOf: string;
  proposals: Proposal[];
  scores: RunScore[];
  state: Pick<AppState, "projects" | "agents"> & Partial<Pick<AppState, "rules">>;
  canJudge: boolean;
  /** What the run is doing right now, while it runs. */
  live?: LiveRun | undefined;
  onDecide: (id: string, decision: "accept" | "dismiss") => void;
  onRate: (id: string, rating: 1 | -1 | null, note?: string) => void;
  onJudge: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const [judging, setJudging] = useState(false);
  const working = run.state === "working" || run.state === "queued";
  useTicker(working);
  const [note, setNote] = useState(run.ratingNote ?? "");
  const tone = run.state === "attention" ? "warn" : run.state === "failed" ? "bad" : run.state === "done" ? "good" : "accent";
  const rules = scores.filter((s) => s.scorer === "rules");
  const judge = scores.filter((s) => s.scorer === "judge");
  const overall = judge.find((s) => s.dimension === "overall");
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const scoreColor = (v: number) => (v >= 0.8 ? C.green : v >= 0.6 ? C.amber : C.red);
  return (
    <Modal title={`${agent?.name ?? run.agentId} · ${project?.name ?? run.proj ?? "workspace"}`} onClose={onClose}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", margin: "8px 0 12px" }}>
        <Chip tone={tone} dot={RUN_COLOR[run.state]}>
          {RUN_STATE_ICON[run.state]} {run.state}
        </Chip>
        <span style={{ fontSize: 12, color: C.dim }}>
          {relTime(run.startedAt, asOf)}
          {run.model ? ` · ${run.model}` : ""}
          {run.finishedAt ? ` · ${Math.max(1, Math.round((new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000))}s` : working ? ` · ${elapsed(run.startedAt)} so far` : ""}
        </span>
      </div>
      {working && (
        <div className="vf-working" style={{ border: `1px solid ${C.accentLine}`, borderRadius: 8, padding: "10px 12px", marginBottom: 12 }}>
          <StepTimeline steps={live?.steps ?? []} startedAt={run.startedAt} working />
        </div>
      )}
      {run.instruction && (
        <div style={{ fontSize: 12, color: C.mut, background: C.inset, border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 10px", marginBottom: 12 }}>
          <span style={{ color: C.dim }}>Instruction · </span>
          {run.instruction}
        </div>
      )}
      {(rules.length > 0 || judge.length > 0 || run.state === "done" || run.state === "attention") && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginBottom: 12, padding: "8px 10px", background: C.inset, border: `1px solid ${C.line}`, borderRadius: 8 }}>
          <span style={{ fontSize: 11, color: C.dim, marginRight: 2 }}>Quality</span>
          {rules.map((s) => (
            <Tip key={s.dimension} label={s.note || s.dimension}>
              <Chip dot={scoreColor(s.score)}>
                {s.dimension.replace("_", " ")} {pct(s.score)}
              </Chip>
            </Tip>
          ))}
          {JUDGE_DIMENSIONS.map((d) => {
            const s = judge.find((x) => x.dimension === d);
            return s ? (
              <Tip key={d} label={s.note || `judge: ${d}`}>
                <Chip dot={scoreColor(s.score)}>
                  {d} {pct(s.score)}
                </Chip>
              </Tip>
            ) : null;
          })}
          {overall && (
            <Chip tone={overall.score >= 0.8 ? "good" : overall.score >= 0.6 ? "warn" : "bad"}>
              judge overall {pct(overall.score)}
            </Chip>
          )}
          <span style={{ flex: 1 }} />
          {judge.length === 0 && canJudge && (run.state === "done" || run.state === "attention") && (
            <button
              type="button"
              className="vf-ghost"
              disabled={judging}
              onClick={() => {
                setJudging(true);
                void onJudge(run.id).finally(() => setJudging(false));
              }}
              style={{ ...ghostBtn, height: 24, opacity: judging ? 0.5 : 1 }}
            >
              {judging ? "Judging…" : "Judge this run"}
            </button>
          )}
          {run.latencyMs !== null && (
            <span style={{ fontSize: 11, color: C.dim }}>
              {(run.latencyMs / 1000).toFixed(1)}s{run.promptTokens !== null ? ` · ${(run.promptTokens ?? 0) + (run.completionTokens ?? 0)} tokens` : ""}
              {run.promptVersion ? ` · prompt ${run.promptVersion}` : ""}
            </span>
          )}
        </div>
      )}
      {overall?.note && <div style={{ fontSize: 12, color: C.mut, lineHeight: 1.5, marginBottom: 12, paddingLeft: 10, borderLeft: `2px solid ${C.line2}` }}>Judge: {overall.note}</div>}
      {(run.state === "done" || run.state === "attention") && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
          <span style={{ fontSize: 11, color: C.dim }}>Was this useful?</span>
          <Tip label="Useful">
            <button type="button" aria-pressed={run.rating === 1} onClick={() => onRate(run.id, run.rating === 1 ? null : 1, note)} className="vf-ghost" style={{ ...ghostBtn, height: 24, color: run.rating === 1 ? C.green : C.mut, borderColor: run.rating === 1 ? C.green : C.line2 }}>
              👍
            </button>
          </Tip>
          <Tip label="Not useful">
            <button type="button" aria-pressed={run.rating === -1} onClick={() => onRate(run.id, run.rating === -1 ? null : -1, note)} className="vf-ghost" style={{ ...ghostBtn, height: 24, color: run.rating === -1 ? C.red : C.mut, borderColor: run.rating === -1 ? C.red : C.line2 }}>
              👎
            </button>
          </Tip>
          <input
            style={{ ...inpStyle, height: 24, fontSize: 12, padding: "0 8px", flex: 1 }}
            value={note}
            placeholder="why? (optional, saved with the rating)"
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => {
              if (run.rating !== null && note !== (run.ratingNote ?? "")) onRate(run.id, run.rating, note);
            }}
          />
        </div>
      )}
      <div style={{ fontSize: 13, fontWeight: 500, color: C.text, marginBottom: 10 }}>{run.summary}</div>
      {proposals.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: C.mut, marginBottom: 6 }}>
            {proposals.filter((p) => p.state === "pending").length} of {proposals.length} proposal{proposals.length === 1 ? "" : "s"} awaiting a decision
          </div>
          <ProposalList proposals={proposals} state={state} asOf={asOf} onDecide={onDecide} />
        </div>
      )}
      {run.state === "failed" ? (
        <div style={{ fontSize: 12.5, color: C.redHi, lineHeight: 1.5 }}>{run.error ?? "The run failed without a message."}</div>
      ) : run.output ? (
        <Markdown text={run.output} />
      ) : (
        <LiveOutput text={live?.text ?? ""} field={agent?.kind === "chat" ? "answer" : agent?.kind === "tuner" ? "analysis" : "body"} />
      )}
      {!working && !run.id.startsWith("pending-") && <RunLog runId={run.id} startedAt={run.startedAt} live={live?.steps} />}
    </Modal>
  );
}
