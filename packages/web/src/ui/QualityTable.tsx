import { EVAL_CASES, agentScorecard, promptVersion } from "@valueflow/domain";
import type { Agent, AgentRun, AgentScorecard, LlmInfo, PromptVersion, Proposal, RunScore } from "@valueflow/domain";
import { AgentQuality } from "./AgentQuality.tsx";
import { Caret, Tip, ghostBtn, reset } from "./primitives.tsx";
import { C } from "../theme.ts";

const pct = (v: number | null): string => (v === null ? "—" : `${Math.round(v * 100)}%`);
const scoreColor = (v: number | null): string => (v === null ? C.line3 : v >= 0.8 ? C.green : v >= 0.6 ? C.amber : C.red);

const th: React.CSSProperties = { fontSize: 10.5, color: C.dim, letterSpacing: "0.05em", textTransform: "uppercase", textAlign: "left", padding: "8px 10px", fontWeight: 500, whiteSpace: "nowrap", borderBottom: `1px solid ${C.line}` };
const td: React.CSSProperties = { fontSize: 13, padding: "9px 10px", color: C.text2, whiteSpace: "nowrap", verticalAlign: "middle", borderTop: `1px solid ${C.line}` };

/** Judge overall per live run, oldest to newest, as a 60×16 line. */
function Spark({ agent, runs, scores }: { agent: Agent; runs: AgentRun[]; scores: RunScore[] }) {
  const pts = runs
    .filter((r) => r.agentId === agent.id && r.benchmark === null)
    .map((r) => ({ at: r.startedAt, v: scores.find((s) => s.runId === r.id && s.scorer === "judge" && s.dimension === "overall")?.score ?? null }))
    .filter((p): p is { at: string; v: number } => p.v !== null)
    .sort((a, b) => (a.at < b.at ? -1 : 1))
    .slice(-12);
  if (pts.length < 2) return <span style={{ color: C.line3 }}>—</span>;
  const w = 60;
  const h = 16;
  const x = (i: number) => (i / (pts.length - 1)) * (w - 2) + 1;
  const y = (v: number) => h - 1 - v * (h - 2);
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1]?.v ?? 0;
  return (
    <Tip label={`Judge overall over the last ${pts.length} judged runs: ${pts.map((p) => Math.round(p.v * 100)).join(" → ")}`}>
      <svg width={w} height={h} style={{ display: "block" }}>
        <path d={d} fill="none" stroke={scoreColor(last)} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(pts.length - 1)} cy={y(last)} r="2" fill={scoreColor(last)} />
      </svg>
    </Tip>
  );
}

function Num({ v, bold }: { v: number | null; bold?: boolean }) {
  return <span style={{ color: scoreColor(v), fontWeight: bold ? 550 : 450 }}>{pct(v)}</span>;
}

/**
 * One row per agent: what the rules and the judge measure, what people
 * decided, what it costs, and the latest benchmark against the previous one.
 * Expanding a row shows prompt versions and models for that agent.
 */
export function QualityTable({
  agents,
  runs,
  scores,
  proposals,
  versions,
  asOf,
  llm,
  busy,
  open,
  onToggle,
  onBenchmark,
  onScout,
  onSetPrompt,
  onTune,
}: {
  agents: Agent[];
  runs: AgentRun[];
  scores: RunScore[];
  proposals: Proposal[];
  versions: PromptVersion[];
  asOf: string;
  llm: LlmInfo | null;
  busy: string | null;
  open: string | null;
  onToggle: (id: string | null) => void;
  onBenchmark: (agentId: string) => void;
  onScout: (agentId: string) => void;
  onSetPrompt: (agentId: string, prompt: string | null) => void;
  onTune: (agentId: string) => void;
}) {
  const cards = new Map<string, AgentScorecard>(agents.map((a) => [a.id, agentScorecard(a, runs, scores, proposals, asOf)]));
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 860 }}>
        <thead>
          <tr>
            <th style={{ ...th, paddingLeft: 14 }}>Agent</th>
            <th style={th}>Runs</th>
            <th style={th}>Format</th>
            <th style={th}>Grounded</th>
            <th style={th}>Judge</th>
            <th style={th}>Trend</th>
            <th style={th}>Accepted</th>
            <th style={th}>Rated</th>
            <th style={th}>Cost</th>
            <th style={th}>Benchmark</th>
            <th style={{ ...th, paddingRight: 14 }} />
          </tr>
        </thead>
        <tbody>
          {agents.map((a) => {
            const c = cards.get(a.id);
            if (!c) return null;
            const expanded = open === a.id;
            const latest = c.benchmarks[0];
            const previous = c.benchmarks[1];
            const delta = latest && previous && latest.overall !== null && previous.overall !== null ? latest.overall - previous.overall : null;
            const benchmarkable = EVAL_CASES.some((ec) => ec.agentId === a.id);
            const running = busy === a.id || busy === "all" || busy === `scout:${a.id}` || busy === "scout:all";
            return (
              <FragmentRow key={a.id}>
                <tr style={{ background: expanded ? C.panel2 : "transparent" }}>
                  <td style={{ ...td, paddingLeft: 14 }}>
                    <button type="button" onClick={() => onToggle(expanded ? null : a.id)} className="vf-row" style={{ ...reset, display: "inline-flex", alignItems: "center", gap: 8, borderRadius: 6, padding: "2px 6px 2px 2px" }}>
                      <Caret open={expanded} />
                      <span style={{ fontSize: 13, fontWeight: 500, color: C.text }}>{a.name}</span>
                    </button>
                  </td>
                  <td style={td}>
                    {c.runs}
                    {c.failed ? <span style={{ color: C.red }}> · {c.failed} failed</span> : ""}
                  </td>
                  <td style={td}>
                    <Num v={c.rules.format} />
                  </td>
                  <td style={td}>
                    <Num v={c.rules.grounding} />
                  </td>
                  <td style={td}>
                    <Tip label={`Groundedness ${pct(c.judge.groundedness)} · completeness ${pct(c.judge.completeness)} · actionability ${pct(c.judge.actionability)} · clarity ${pct(c.judge.clarity)} · ${c.judge.judged} judged`}>
                      <Num v={c.judge.overall} bold />
                    </Tip>
                  </td>
                  <td style={td}>
                    <Spark agent={a} runs={runs} scores={scores} />
                  </td>
                  <td style={td}>
                    <Num v={c.proposals.acceptanceRate} />
                    <span style={{ color: C.dim, fontSize: 11 }}> of {c.proposals.total}</span>
                  </td>
                  <td style={td}>
                    <span style={{ color: c.ratings.up ? C.green : C.dim }}>👍 {c.ratings.up}</span> <span style={{ color: c.ratings.down ? C.red : C.dim }}>👎 {c.ratings.down}</span>
                  </td>
                  <td style={{ ...td, color: C.mut }}>
                    {c.latencyMedianMs === null ? "—" : `${(c.latencyMedianMs / 1000).toFixed(0)}s`}
                    {c.tokensMean === null ? "" : ` · ${Math.round(c.tokensMean / 100) / 10}k`}
                  </td>
                  <td style={td}>
                    {latest ? (
                      <Tip label={`${latest.day}: ${latest.n} cases, prompt ${latest.promptVersion ?? "?"}, ${latest.model ?? "?"} · expectations ${pct(latest.expectations)}${previous ? ` · previous ${previous.day} prompt ${previous.promptVersion ?? "?"}` : ""}`}>
                        <span>
                          <Num v={latest.overall} bold />
                          {delta !== null && <span style={{ color: delta >= 0 ? C.green : C.red, fontSize: 11 }}> {delta >= 0 ? "▲" : "▼"}{Math.abs(Math.round(delta * 100))}</span>}
                        </span>
                      </Tip>
                    ) : (
                      <span style={{ color: C.line3 }}>—</span>
                    )}
                  </td>
                  <td style={{ ...td, paddingRight: 14, textAlign: "right" }}>
                    {benchmarkable && (
                      <button type="button" className="vf-ghost" disabled={running || !llm} onClick={() => onBenchmark(a.id)} style={{ ...ghostBtn, height: 24, opacity: running || !llm ? 0.5 : 1 }}>
                        {running ? "Running…" : "Benchmark"}
                      </button>
                    )}
                  </td>
                </tr>
                {expanded && (
                  <tr>
                    <td colSpan={11} style={{ padding: "0 14px 6px 36px", background: C.panel2, borderTop: `1px solid ${C.line}` }}>
                      <AgentQuality
                        agent={a}
                        currentVersion={a.kind === "scout" ? null : promptVersion(a.kind, a.prompt)}
                        runs={runs}
                        scores={scores}
                        versions={versions}
                        llm={llm}
                        busy={busy !== null}
                        onSetPrompt={(prompt) => onSetPrompt(a.id, prompt)}
                        onTune={() => onTune(a.id)}
                        onScout={() => onScout(a.id)}
                      />
                    </td>
                  </tr>
                )}
              </FragmentRow>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** A keyed fragment for table rows (React.Fragment with a key). */
function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
