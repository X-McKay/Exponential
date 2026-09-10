import { useState } from "react";
import { AGENT_KIND_LABEL, PROJECT_TABS, RUN_STATE_ICON, relTime } from "@valueflow/domain";
import type { Agent, AgentRun, AppState, Project, ProjectTab, Proposal } from "@valueflow/domain";
import type { RunAgentInput } from "@valueflow/shared";
import { ProposalList } from "../ui/Proposals.tsx";
import { Btn, Chip, Lbl, Modal, inpStyle } from "../ui/primitives.tsx";
import { C, RUN_COLOR } from "../theme.ts";

const TAB_LABEL: Record<ProjectTab, string> = { overview: "Overview", value: "Value", roadmap: "Roadmap", development: "Development", governance: "Governance" };
const isTab = (s: string): s is ProjectTab => (PROJECT_TABS as readonly string[]).includes(s);

const PLACEHOLDER: Record<Agent["kind"], string> = {
  deck: "e.g. 10-slide AIRC pre-read focused on the recall gate and the R1 criteria",
  comms: "e.g. Decision memo on the 88% vs 90% recall threshold for compliance SMEs",
  ideation: "e.g. Options to lift citation accuracy without adding reviewer load",
  audit: "e.g. Focus on audit-trail gaps for rule activations",
};

/** Start a run: pick the project (and optionally where the result should link) and give the agent an instruction. */
export function RunAgentEditor({
  agent,
  projects,
  defaultProject,
  onRun,
  onClose,
}: {
  agent: Agent;
  projects: Project[];
  defaultProject: string | null;
  onRun: (input: RunAgentInput) => void;
  onClose: () => void;
}) {
  const [proj, setProj] = useState(defaultProject ?? projects[0]?.id ?? "");
  const [tab, setTab] = useState<ProjectTab | "">("");
  const [instruction, setInstruction] = useState("");
  const valid = proj !== "";
  const submit = () => {
    if (!valid) return;
    onRun({ agentId: agent.id, proj, ...(tab ? { tab } : {}), ...(instruction.trim() ? { instruction: instruction.trim() } : {}) });
  };
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
function Markdown({ text }: { text: string }) {
  const inline = (s: string) =>
    s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
      if (part.startsWith("`") && part.endsWith("`"))
        return (
          <code key={i} style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, background: "#0E1015", padding: "0 4px", borderRadius: 3 }}>
            {part.slice(1, -1)}
          </code>
        );
      return part;
    });
  const blocks: { kind: "h" | "li" | "ol" | "p"; level?: number; text: string }[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) blocks.push({ kind: "h", level: h[1]?.length ?? 2, text: h[2] ?? "" });
    else if (/^\s*[-*•]\s+/.test(line)) blocks.push({ kind: "li", text: line.replace(/^\s*[-*•]\s+/, "") });
    else if (/^\s*\d+[.)]\s+/.test(line)) blocks.push({ kind: "ol", text: line.replace(/^\s*\d+[.)]\s+/, "") });
    else blocks.push({ kind: "p", text: line });
  }
  return (
    <div style={{ fontSize: 13, lineHeight: 1.6, color: "#C6CAD6" }}>
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
  state,
  onDecide,
  onClose,
}: {
  run: AgentRun;
  agent: Agent | undefined;
  project: Project | undefined;
  asOf: string;
  proposals: Proposal[];
  state: Pick<AppState, "projects" | "agents">;
  onDecide: (id: string, decision: "accept" | "dismiss") => void;
  onClose: () => void;
}) {
  const tone = run.state === "attention" ? "warn" : run.state === "failed" ? "bad" : run.state === "done" ? "good" : "accent";
  return (
    <Modal title={`${agent?.name ?? run.agentId} · ${project?.name ?? run.proj}`} onClose={onClose}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", margin: "8px 0 12px" }}>
        <Chip tone={tone} dot={RUN_COLOR[run.state]}>
          {RUN_STATE_ICON[run.state]} {run.state}
        </Chip>
        <span style={{ fontSize: 12, color: C.dim }}>
          {relTime(run.startedAt, asOf)}
          {run.model ? ` · ${run.model}` : ""}
          {run.finishedAt ? ` · ${Math.max(1, Math.round((new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000))}s` : ""}
        </span>
      </div>
      {run.instruction && (
        <div style={{ fontSize: 12, color: C.mut, background: "#0E1015", border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 10px", marginBottom: 12 }}>
          <span style={{ color: C.dim }}>Instruction · </span>
          {run.instruction}
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
        <div style={{ fontSize: 12.5, color: "#F08A84", lineHeight: 1.5 }}>{run.error ?? "The run failed without a message."}</div>
      ) : run.output ? (
        <Markdown text={run.output} />
      ) : (
        <div style={{ fontSize: 12, color: C.dim }}>Still working…</div>
      )}
    </Modal>
  );
}
