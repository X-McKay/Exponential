import { callLlm } from "./usage.ts";
import { nextStoredRunId, nextStoredProposalId } from "./ids.ts";
import { registerProposalGuard } from "./proposal-guard.ts";
// ================= prompt tuner =================
//
// Closes the loop between measurement and prompts. The tuner reads an agent's
// worst recent runs (judge critiques, unsupported claims, missed benchmark
// expectations, thumbs-down notes), then proposes a change to that agent's
// extra instructions. Nothing changes until a person accepts; accepting
// records a prompt version and re-runs the benchmark, so the next version's
// numbers sit beside the last one's.

import type { Database } from "bun:sqlite";
import { PROJECT_KINDS, agentScorecard, promptHistory } from "@valueflow/domain";
import type { Agent, AgentRun, AppState, Proposal } from "@valueflow/domain";
import { clip } from "./agents.ts";
import { ruleScores } from "./evals.ts";
import { extractJson } from "./llm.ts";
import type { ChatMessage, Llm } from "./llm.ts";
import { replyDetail, trace } from "./live.ts";
import { ROLE, promptVersion } from "./prompts.ts";
import { NotFound, insertProposal, insertRun, loadState, updateRun, upsertScore } from "./repo.ts";

export const TUNER_MIN_RUNS = 3;

/** Agents the tuner may work on: those that produce measured, prompted output. */
export const tunable = (state: Pick<AppState, "agents">): Agent[] => state.agents.filter((a) => PROJECT_KINDS.includes(a.kind) || a.kind === "brief");

const pct = (v: number | null) => (v === null ? "n/a" : `${Math.round(v * 100)}%`);

/** The evidence pack: scorecard, version history, and the worst runs with what the judge and people said. */
export const tunerContext = (state: AppState, target: Agent): string => {
  const card = agentScorecard(target, state.runs, state.scores, state.proposals, state.asOf);
  const history = promptHistory(target, promptVersion(target.kind, target.prompt, target.id), state.runs, state.scores, state.promptVersions);
  const finished = state.runs.filter((r) => r.agentId === target.id && (r.state === "done" || r.state === "attention" || r.state === "failed"));
  const overallOf = (id: string) => state.scores.find((s) => s.runId === id && s.scorer === "judge" && s.dimension === "overall")?.score ?? null;
  const worst = [...finished].sort((a, b) => (overallOf(a.id) ?? (a.state === "failed" ? -1 : 2)) - (overallOf(b.id) ?? (b.state === "failed" ? -1 : 2))).slice(0, 6);
  const runLines = worst.map((r) => {
    const sc = state.scores.filter((s) => s.runId === r.id);
    const pick = (scorer: string, dim: string) => sc.find((s) => s.scorer === scorer && s.dimension === dim);
    const lines = [
      `### ${r.id} — ${r.state}, judge overall ${pct(overallOf(r.id))}, grounding ${pct(pick("rules", "grounding")?.score ?? null)}${r.rating === -1 ? ", rated NOT USEFUL" : r.rating === 1 ? ", rated useful" : ""}${r.benchmark ? ` (benchmark case ${r.benchmark})` : ""}`,
      r.instruction ? `Instruction: ${r.instruction}` : "",
      r.error ? `Error: ${r.error}` : "",
      pick("judge", "overall")?.note ? `Judge critique: ${pick("judge", "overall")?.note}` : "",
      pick("judge", "groundedness")?.note ? `Judge: ${pick("judge", "groundedness")?.note}` : "",
      pick("rules", "grounding")?.note ? `Rules: ${pick("rules", "grounding")?.note}` : "",
      pick("judge", "expectations")?.note ? `Expectations:\n${pick("judge", "expectations")?.note}` : "",
      r.ratingNote ? `Person's note: ${r.ratingNote}` : "",
      r.output ? `Output (first 600 chars): ${r.output.slice(0, 600).replace(/\n+/g, " ")}` : "",
    ];
    return lines.filter(Boolean).join("\n");
  });
  return [
    `# ${target.name} (kind ${target.kind}) — evidence as of ${state.asOf.slice(0, 10)}`,
    `Built-in role: ${ROLE[target.kind].brief}\nBuilt-in task: ${ROLE[target.kind].task}`,
    `Current extra instructions (version ${promptVersion(target.kind, target.prompt, target.id)}): ${target.prompt ? `\n"""\n${target.prompt}\n"""` : "none"}`,
    `\n## Scorecard, last 30 days\n${card.runs} runs, ${card.failed} failed. Rules: format ${pct(card.rules.format)}, grounding ${pct(card.rules.grounding)}, proposals valid ${pct(card.rules.proposalsValid)}. Judge (${card.judge.judged} judged): groundedness ${pct(card.judge.groundedness)}, completeness ${pct(card.judge.completeness)}, actionability ${pct(card.judge.actionability)}, clarity ${pct(card.judge.clarity)}, overall ${pct(card.judge.overall)}. Ratings: ${card.ratings.up} up, ${card.ratings.down} down. Proposals accepted ${pct(card.proposals.acceptanceRate)} of ${card.proposals.total}.`,
    `\n## Prompt versions tried\n${history.map((h) => `- ${h.version}${h.current ? " (current)" : ""}, ${h.source}${h.since ? ` since ${h.since.slice(0, 10)}` : ""}: ${h.runs} runs, judge ${pct(h.judge)}, grounding ${pct(h.grounding)}, benchmark ${pct(h.benchmark.overall)} over ${h.benchmark.n} cases, expectations ${pct(h.benchmark.expectations)}, ${h.up} up / ${h.down} down${h.prompt ? ` — instructions: "${h.prompt.slice(0, 200)}"` : ""}`).join("\n") || "- none recorded"}`,
    `\n## Weakest runs\n${runLines.join("\n\n") || "none"}`,
  ].join("\n");
};

const TUNE_SCHEMA = {
  name: "prompt_tuning",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      analysis: { type: "string", description: "Markdown: the two or three weaknesses the evidence shows, each with the run ids and scores that prove it." },
      prompt: { type: "string", description: "The complete new extra instructions for the agent, under 250 words, as imperative sentences. Empty string if no change is justified." },
      change: { type: "string", description: "One or two sentences: what the new instructions change and which measured number should move." },
    },
    required: ["analysis", "prompt", "change"],
  },
};

export const buildTunerMessages = (tuner: Agent, state: AppState, target: Agent): ChatMessage[] => [
  {
    role: "system",
    content: [
      `You are ${tuner.name}, the prompt tuner in Exponential. You improve another agent's extra instructions from measured evidence only: judge critiques, unsupported claims, failed expectations, people's ratings.`,
      "Do not restate the built-in role; write only the extra instructions that fix what the evidence shows. Keep what works. Be specific: name the failure mode and the rule that prevents it (for example: 'Before citing a figure, find it in the briefing; if absent, write \"not in briefing\"'). Under 250 words. If the evidence does not justify a change, return an empty prompt and say why in the analysis.",
      ...(tuner.prompt ? [`\nAdditional instructions from the workspace:\n${tuner.prompt}`] : []),
      'Reply with a JSON object: {"analysis": string, "prompt": string, "change": string}.',
    ].join("\n"),
  },
  { role: "user", content: tunerContext(state, target) },
];

/** Study one agent and propose a prompt change; returns the tuner's run. */
export const tuneAgent = async (db: Database, llm: Llm, tuner: Agent, targetId: string, now: Date): Promise<AgentRun> => {
  const state = loadState(db, now);
  const target = state.agents.find((a) => a.id === targetId);
  if (!target) throw new NotFound(`agent ${targetId} not found`);
  const measured = state.runs.filter((r) => r.agentId === target.id && (r.state === "done" || r.state === "attention" || r.state === "failed")).length;
  const messages = buildTunerMessages(tuner, state, target);
  const started = Date.now();
  const run: AgentRun = {
    id: nextStoredRunId(db),
    agentId: tuner.id,
    proj: null,
    tab: "overview",
    state: "working",
    startedAt: now.toISOString(),
    finishedAt: null,
    instruction: `Tune ${target.name}`,
    summary: `${tuner.name} is studying ${target.name}…`,
    output: "",
    model: null,
    error: null,
    promptVersion: promptVersion("tuner", tuner.prompt),
    latencyMs: null,
    promptTokens: null,
    completionTokens: null,
    benchmark: null,
    rating: null,
    ratingNote: null,
  };
  insertRun(db, run, messages[1]?.content ?? "");
  const t = trace(db, run);
  t.step("briefing", `${target.name}: ${measured} measured run${measured === 1 ? "" : "s"}, scorecard, prompt history, weakest runs with critiques`);
  if (measured < TUNER_MIN_RUNS) {
    const done: AgentRun = { ...run, state: "done", finishedAt: new Date().toISOString(), summary: `${target.name}: not enough measured runs to tune (${measured} of ${TUNER_MIN_RUNS})`, output: `${target.name} has ${measured} finished run${measured === 1 ? "" : "s"} in the window. The tuner needs at least ${TUNER_MIN_RUNS}, with judge scores, before it will propose a change. Run the benchmark or let the agent work for a while.`, latencyMs: Date.now() - started };
    updateRun(db, done);
    t.step("done", `not enough measured runs (${measured} of ${TUNER_MIN_RUNS}); no model call`);
    t.finished("done");
    return done;
  }
  try {
    t.step("request", `${tuner.model ?? llm.describe().model ?? "default model"}, JSON schema`);
    const asked = Date.now();
    const res = await callLlm(db, llm, { agentId: tuner.id, proj: null, runId: run.id }, messages, { jsonSchema: TUNE_SCHEMA, maxTokens: 2500, temperature: 0.2, model: tuner.model, onToken: t.token }, now);
    t.step("reply", replyDetail(res.usage, Date.now() - asked, res.truncated));
    const raw = extractJson(res.content);
    const o = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    const analysis = typeof o.analysis === "string" ? o.analysis.trim() : "";
    const prompt = typeof o.prompt === "string" ? o.prompt.trim().slice(0, 4000) : "";
    const change = typeof o.change === "string" ? o.change.trim().slice(0, 400) : "";
    if (!analysis) throw new Error("reply had no analysis");
    const proposes = prompt.length > 0 && prompt !== (target.prompt ?? "");
    const body = `${analysis}${proposes ? `\n\n## Proposed extra instructions for ${target.name}\n${prompt}\n\n${change}` : "\n\nNo prompt change proposed."}`;
    const finished: AgentRun = { ...run, state: "done", finishedAt: new Date().toISOString(), summary: clip(proposes ? `${target.name}: ${change || "prompt change proposed"}` : `${target.name}: no change justified`, 140), output: body, model: res.model, latencyMs: Date.now() - started, promptTokens: res.usage?.prompt ?? null, completionTokens: res.usage?.completion ?? null };
    updateRun(db, finished);
    t.step("parsed", finished.summary);
    if (proposes) {
      const proposal: Proposal = { id: nextStoredProposalId(db), runId: run.id, agentId: tuner.id, proj: null, ruleId: null, action: { type: "agent_prompt", agentId: target.id, prompt }, rationale: change || `Proposed by ${tuner.name} from ${measured} measured runs.`, state: "pending", createdAt: now.toISOString(), decidedAt: null };
      db.transaction(() => {
        insertProposal(db, proposal);
        registerProposalGuard(db, proposal, state);
      })();
      t.step("proposals", `${proposal.id}: new instructions for ${target.name} (${prompt.split(/\s+/).length} words)`);
    } else t.step("proposals", "no change justified");
    const scores = ruleScores({ run: finished, briefing: messages[1]?.content ?? "", proposalsReturned: proposes ? 1 : 0, proposalsKept: proposes ? 1 : 0 }, finished.finishedAt ?? now.toISOString());
    for (const s of scores) upsertScore(db, s);
    t.step("scored", scores.map((s) => `${s.dimension.replace("_", " ")} ${Math.round(s.score * 100)}%`).join(" · "));
    t.step("done", `finished in ${((finished.latencyMs ?? 0) / 1000).toFixed(1)}s`);
    t.finished("done");
    return finished;
  } catch (e) {
    const failed: AgentRun = { ...run, state: "failed", finishedAt: new Date().toISOString(), summary: `${tuner.name} could not study ${target.name}`, error: e instanceof Error ? e.message : String(e), latencyMs: Date.now() - started };
    updateRun(db, failed);
    t.step("failed", failed.error ?? "unknown error");
    t.finished("failed");
    return failed;
  }
};
