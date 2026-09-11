// ================= Glance curator =================
//
// Generative UI with a short leash. The composer still finds every card from
// facts; the curator only chooses among them: which to show, in which zone
// (decide / watch / know), in what order, and why each matters to the reader
// today. The layout is stored as pointers to block ids, so it never carries
// a number that could go stale, and it is a run like any other: rule-scored
// for validity, judged, rated, and benchmarked.

import type { Database } from "bun:sqlite";
import { ZONES, blocksHash, calendarOf, composeGlance, describeBlock, nextRunId, validPlacements } from "@valueflow/domain";
import type { Agent, AgentRun, AppState, Block, GlanceLayout } from "@valueflow/domain";
import { clip } from "./agents.ts";
import { ruleScores } from "./evals.ts";
import { extractJson } from "./llm.ts";
import type { ChatMessage, Llm } from "./llm.ts";
import { promptVersion } from "./prompts.ts";
import { insertLayout, insertRun, loadState, updateRun, upsertScore } from "./repo.ts";

export const MAX_CARDS = 6;

/** The reader and the candidates, nothing else. */
export const curatorContext = (state: AppState, blocks: Block[]): string => {
  const user = state.workspace.user;
  const owned = state.projects.flatMap((p) => p.governance.filter((g) => g.owner === user.ini && g.status !== "approved" && g.status !== "na").map((g) => `${p.name}: ${g.name} (${g.status})`));
  const pending = state.proposals.filter((p) => p.state === "pending");
  return [
    `# Reader: ${user.name} (${user.ini}), as of ${state.asOf.slice(0, 10)}${state.workspace.lastGlanceAt ? `; last opened Glance ${state.workspace.lastGlanceAt.slice(0, 16).replace("T", " ")}` : "; first visit"}`,
    `Owns ${owned.length} open governance item${owned.length === 1 ? "" : "s"}${owned.length ? `: ${owned.slice(0, 6).join("; ")}` : ""}. ${pending.length} proposal${pending.length === 1 ? "" : "s"} waiting on a decision.`,
    `\n# Candidate cards (${blocks.length}), in the composer's order. Use these ids and nothing else.`,
    ...blocks.map((b) => `- ${describeBlock(b)}`),
  ].join("\n");
};

const layoutSchema = (ids: string[]) => ({
  name: "glance_layout",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      headline: { type: "string", description: "Under 120 characters: the one thing the reader should know this morning." },
      placements: {
        type: "array",
        maxItems: MAX_CARDS,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            zone: { type: "string", enum: [...ZONES] },
            blockId: { type: "string", enum: ids },
            why: { type: "string", description: "One line, under 140 characters, on why this matters to the reader today; cite the card's own facts." },
          },
          required: ["zone", "blockId", "why"],
        },
      },
    },
    required: ["headline", "placements"],
  },
});

export const buildCuratorMessages = (agent: Agent, state: AppState, blocks: Block[]): ChatMessage[] => [
  {
    role: "system",
    content: [
      `You are ${agent.name}, the Glance curator in ValueFlow, an AI-project delivery platform. You lay out one person's morning page from cards a deterministic composer already found. You never invent a card, a number, or a fact.`,
      `Pick at most ${MAX_CARDS} cards. Zones: decide = needs the reader's decision or sign-off now (proposals, agent flags, releases ready to ship); watch = a risk or a gate to keep an eye on (blocked releases, metrics under a gate, failing CI, Tier 1 gaps, stretch within reach, value trajectory); know = what happened and what is coming (the brief, activity, upcoming).`,
      "Order within a zone by urgency for this reader: things they own or must decide first. A blocked release, a Tier 1 gap, or pending proposals must never be left out while lesser cards are shown. Skip cards that repeat another card's point.",
      "For each card write one line on why it matters to this reader today, using only the facts in the card's line. Write a headline under 120 characters as one plain sentence in sentence case (no title case, no semicolons) that says the single most important thing.",
      ...(agent.prompt ? [`\nAdditional instructions from the workspace:\n${agent.prompt}`] : []),
      'Reply with a JSON object: {"headline": string, "placements": [{"zone": "decide|watch|know", "blockId": string, "why": string}]}.',
    ].join("\n"),
  },
  { role: "user", content: curatorContext(state, blocks) },
];

export interface CurateOptions {
  benchmark?: string | undefined;
}

/** Curate Glance for the signed-in user; returns the run, with the layout stored when it succeeded. */
export const curateGlance = async (db: Database, llm: Llm, agent: Agent, now: Date, options: CurateOptions = {}): Promise<AgentRun> => {
  const state = loadState(db, now);
  const blocks = composeGlance(state, calendarOf(state));
  const messages = buildCuratorMessages(agent, state, blocks);
  const briefing = messages[1]?.content ?? "";
  const started = Date.now();
  const run: AgentRun = {
    id: nextRunId(state.runs),
    agentId: agent.id,
    proj: null,
    tab: "overview",
    state: "working",
    startedAt: now.toISOString(),
    finishedAt: null,
    instruction: `Glance for ${state.workspace.user.name}`,
    summary: `${agent.name} is laying out Glance…`,
    output: "",
    model: null,
    error: null,
    promptVersion: promptVersion("curator", agent.prompt),
    latencyMs: null,
    promptTokens: null,
    completionTokens: null,
    benchmark: options.benchmark ?? null,
    rating: null,
    ratingNote: null,
  };
  insertRun(db, run, briefing);
  if (blocks.length === 0) {
    const done: AgentRun = { ...run, state: "done", finishedAt: new Date().toISOString(), summary: "Nothing to lay out: the composer found no cards", output: "The workspace has no signals today, so Glance shows the empty state.", latencyMs: Date.now() - started };
    updateRun(db, done);
    return done;
  }
  try {
    const res = await llm.chat(messages, { jsonSchema: layoutSchema(blocks.map((b) => b.id)), maxTokens: 1500, temperature: 0.2, model: agent.model });
    const raw = extractJson(res.content);
    const o = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    const headline = typeof o.headline === "string" ? clip(o.headline.trim(), 140) : "";
    const returned = Array.isArray(o.placements) ? o.placements.length : 0;
    const placements = validPlacements(o.placements, blocks).slice(0, MAX_CARDS);
    if (!headline || placements.length === 0) throw new Error(`reply had ${headline ? "no valid placements" : "no headline"}`);
    const byId = new Map(blocks.map((b) => [b.id, b]));
    const body = [
      `# ${headline}`,
      ...ZONES.map((z) => {
        const rows = placements.filter((p) => p.zone === z);
        return rows.length ? `\n## ${z === "decide" ? "Decide" : z === "watch" ? "Watch" : "Know"}\n${rows.map((p) => `- **${byId.get(p.blockId)?.title ?? p.blockId}** — ${p.why}`).join("\n")}` : "";
      }),
      blocks.length > placements.length ? `\n_${blocks.length - placements.length} of ${blocks.length} cards folded into "more"._` : "",
    ]
      .filter(Boolean)
      .join("\n");
    const finished: AgentRun = { ...run, state: "done", finishedAt: new Date().toISOString(), summary: headline, output: body, model: res.model, latencyMs: Date.now() - started, promptTokens: res.usage?.prompt ?? null, completionTokens: res.usage?.completion ?? null };
    updateRun(db, finished);
    if (!options.benchmark) {
      const layout: GlanceLayout = { runId: run.id, at: finished.finishedAt ?? now.toISOString(), stateHash: blocksHash(blocks), headline, placements, model: res.model };
      insertLayout(db, state.workspace.user.ini, layout);
    }
    for (const s of ruleScores({ run: finished, briefing, proposalsReturned: 0, proposalsKept: 0, placements: { returned, kept: placements.length } }, finished.finishedAt ?? now.toISOString())) upsertScore(db, s);
    return finished;
  } catch (e) {
    const failed: AgentRun = { ...run, state: "failed", finishedAt: new Date().toISOString(), summary: `${agent.name} could not lay out Glance`, error: e instanceof Error ? e.message : String(e), latencyMs: Date.now() - started };
    updateRun(db, failed);
    return failed;
  }
};

/** Whether the stored layout still matches what the composer finds now. */
export const layoutIsCurrent = (state: AppState): boolean => {
  if (!state.layout) return false;
  return state.layout.stateHash === blocksHash(composeGlance(state, calendarOf(state)));
};
