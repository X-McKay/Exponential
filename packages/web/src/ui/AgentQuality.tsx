import { useState } from "react";
import { modelComparison, promptHistory } from "@valueflow/domain";
import type { Agent, AgentRun, LlmInfo, PromptVersion, RunScore } from "@valueflow/domain";
import { Btn, Chip, Modal, Tip, ghostBtn, inpStyle } from "./primitives.tsx";
import { C } from "../theme.ts";

const pct = (v: number | null): string => (v === null ? "—" : `${Math.round(v * 100)}%`);
const scoreColor = (v: number | null): string => (v === null ? C.dim : v >= 0.8 ? C.green : v >= 0.6 ? C.amber : C.red);
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");

const th: React.CSSProperties = { fontSize: 10.5, color: C.dim, letterSpacing: "0.04em", textTransform: "uppercase", textAlign: "left", padding: "4px 12px 4px 0", fontWeight: 500, whiteSpace: "nowrap" };
const td: React.CSSProperties = { fontSize: 12.5, padding: "5px 12px 5px 0", color: "#C6CAD6", whiteSpace: "nowrap", verticalAlign: "top" };

/** Edit the extra instructions layered on an agent's built-in role. Saving records a prompt version. */
function InstructionsEditor({ agent, onSave, onClose }: { agent: Agent; onSave: (prompt: string | null) => void; onClose: () => void }) {
  const [text, setText] = useState(agent.prompt ?? "");
  const submit = () => onSave(text.trim() ? text.trim() : null);
  return (
    <Modal
      title={`${agent.name} · extra instructions`}
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn tone="primary" onClick={submit}>
            Save as new version
          </Btn>
        </>
      }
    >
      <div style={{ fontSize: 12, color: C.mut, lineHeight: 1.55, marginTop: 8 }}>
        These sit under the built-in role for this kind of agent. Every save is a new prompt version; runs record which version they used, so the table shows what each wording measured. Leave empty to return to the built-in prompt alone.
      </div>
      <textarea
        style={{ ...inpStyle, height: "auto", minHeight: 160, padding: "8px 10px", resize: "vertical", lineHeight: 1.5, marginTop: 10 }}
        value={text}
        autoFocus
        placeholder="e.g. Before citing any figure, find it in the briefing; if it is absent write 'not in briefing'. Lead every finding with the release it affects."
        onChange={(e) => setText(e.target.value)}
      />
    </Modal>
  );
}

/**
 * The closed loop for one agent: which prompt versions it has run under and
 * what each measured, which models were tried on the same cases, and the
 * buttons that move it forward (tune, edit, scout).
 */
export function AgentQuality({
  agent,
  currentVersion,
  runs,
  scores,
  versions,
  llm,
  busy,
  onSetPrompt,
  onTune,
  onScout,
}: {
  agent: Agent;
  currentVersion: string | null;
  runs: AgentRun[];
  scores: RunScore[];
  versions: PromptVersion[];
  llm: LlmInfo | null;
  busy: boolean;
  onSetPrompt: (prompt: string | null) => void;
  onTune: () => void;
  onScout: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [showVersion, setShowVersion] = useState<string | null>(null);
  const history = promptHistory(agent, currentVersion, runs, scores, versions);
  const models = modelComparison(agent, runs, scores, currentVersion);
  const current = agent.model ?? llm?.model ?? null;
  const canTune = llm !== null && !busy;
  const canScout = llm !== null && !busy && (llm.models.length ?? 0) >= 2;
  const shown = history.find((h) => h.version === showVersion);
  return (
    <div style={{ padding: "6px 0 10px", display: "grid", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: C.mut, flex: 1, minWidth: 200 }}>
          Extra instructions: {agent.prompt ? <span style={{ color: "#C6CAD6" }}>{agent.prompt.length > 140 ? `${agent.prompt.slice(0, 140)}…` : agent.prompt}</span> : <span style={{ color: C.dim }}>none (built-in prompt only)</span>}
        </span>
        <button type="button" className="vf-ghost" onClick={() => setEditing(true)} style={{ ...ghostBtn, height: 24 }}>
          Edit instructions
        </button>
        <Tip label={llm ? "Coach reads this agent's weakest runs and proposes a prompt change" : "Set LLM_BASE_URL to enable"}>
          <button type="button" className="vf-ghost" disabled={!canTune} onClick={onTune} style={{ ...ghostBtn, height: 24, color: C.indigoHi, opacity: canTune ? 1 : 0.5 }}>
            Tune prompt
          </button>
        </Tip>
        <Tip label={llm && llm.models.length >= 2 ? `Benchmark ${llm.models.filter((m) => m !== current).join(", ")} against ${current ?? "the current model"}` : "Add candidate models with LLM_MODELS to compare"}>
          <button type="button" className="vf-ghost" disabled={!canScout} onClick={onScout} style={{ ...ghostBtn, height: 24, opacity: canScout ? 1 : 0.5 }}>
            Scout models
          </button>
        </Tip>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={th}>Prompt version</th>
              <th style={th}>Since</th>
              <th style={th}>Source</th>
              <th style={th}>Runs</th>
              <th style={th}>Grounded</th>
              <th style={th}>Judge</th>
              <th style={th}>Rated</th>
              <th style={th}>Benchmark</th>
              <th style={th}>Expectations</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.version} style={{ borderTop: `1px solid ${C.line}` }}>
                <td style={td}>
                  <button type="button" onClick={() => setShowVersion(showVersion === h.version ? null : h.version)} className="vf-link" style={{ ...ghostBtn, height: 22, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, padding: "0 6px" }}>
                    {h.version}
                  </button>
                  {h.current && (
                    <span style={{ marginLeft: 6 }}>
                      <Chip tone="accent">current</Chip>
                    </span>
                  )}
                </td>
                <td style={td}>{day(h.since)}</td>
                <td style={{ ...td, color: C.dim }}>{h.source === "builtin" ? "built-in" : h.source}</td>
                <td style={td}>
                  {h.runs}
                  {h.failed ? <span style={{ color: C.red }}> · {h.failed} failed</span> : ""}
                </td>
                <td style={{ ...td, color: scoreColor(h.grounding), fontWeight: 550 }}>{pct(h.grounding)}</td>
                <td style={{ ...td, color: scoreColor(h.judge), fontWeight: 550 }}>{pct(h.judge)}</td>
                <td style={td}>
                  <span style={{ color: C.green }}>👍 {h.up}</span> <span style={{ color: C.red }}>👎 {h.down}</span>
                </td>
                <td style={{ ...td, color: scoreColor(h.benchmark.overall), fontWeight: 550 }}>
                  {pct(h.benchmark.overall)}
                  {h.benchmark.n ? <span style={{ color: C.dim, fontWeight: 400 }}> · {h.benchmark.n} cases</span> : ""}
                  {h.benchmark.failed ? <span style={{ color: C.red, fontWeight: 400 }}> · {h.benchmark.failed} failed</span> : ""}
                </td>
                <td style={{ ...td, color: scoreColor(h.benchmark.expectations), fontWeight: 550 }}>{pct(h.benchmark.expectations)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown && (
          <pre style={{ margin: "6px 0 0", whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 12, lineHeight: 1.55, color: "#C6CAD6", background: "#0B0C0E", border: `1px solid ${C.line}`, borderRadius: 6, padding: "8px 10px" }}>
            {shown.prompt === undefined ? "Instructions for this version were not recorded (set in code before versions were kept)." : shown.prompt === null ? "Built-in instructions only." : shown.prompt}
          </pre>
        )}
      </div>

      {models.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <div style={{ fontSize: 11, color: C.dim, marginBottom: 2 }}>Models on the current prompt version, same cases, same judge</div>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={th}>Model</th>
                <th style={th}>Cases</th>
                <th style={th}>Judge</th>
                <th style={th}>Expectations</th>
                <th style={th}>Grounded</th>
                <th style={th}>Latency</th>
                <th style={th}>Tokens</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.model} style={{ borderTop: `1px solid ${C.line}` }}>
                  <td style={td}>
                    {m.model}
                    {m.model === current && (
                      <span style={{ marginLeft: 6 }}>
                        <Chip tone="accent">current</Chip>
                      </span>
                    )}
                  </td>
                  <td style={td}>
                    {m.n}
                    {m.failed ? <span style={{ color: C.red }}> · {m.failed} failed</span> : ""}
                  </td>
                  <td style={{ ...td, color: scoreColor(m.overall), fontWeight: 550 }}>{pct(m.overall)}</td>
                  <td style={{ ...td, color: scoreColor(m.expectations), fontWeight: 550 }}>{pct(m.expectations)}</td>
                  <td style={{ ...td, color: scoreColor(m.grounding) }}>{pct(m.grounding)}</td>
                  <td style={td}>{m.latencyMedianMs === null ? "—" : `${(m.latencyMedianMs / 1000).toFixed(0)}s`}</td>
                  <td style={td}>{m.tokensMean === null ? "—" : Math.round(m.tokensMean)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <InstructionsEditor
          agent={agent}
          onSave={(prompt) => {
            onSetPrompt(prompt);
            setEditing(false);
          }}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}
