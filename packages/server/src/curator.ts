// ================= the daily brief (Glance curator) =================
//
// Generative UI with a short leash. A deterministic composer finds every
// signal from facts; the curator writes the reader's daily brief from those
// signals: a few paragraphs of need-to-know, each with at most one widget
// where a visual earns its place (a gate, release criteria, the governance
// stack, the value trajectory, the proposals, a failing PR, upcoming events,
// activity, or a small table). Widgets point at facts by id and render from
// live state, so the brief never carries a number that can go stale except
// in its own prose, which the grounding rule checks. The brief is a run:
// rule-scored, judged, rated on the page, and benchmarked.

import type { Database } from "bun:sqlite";
import { WIDGET_TYPES, blocksHash, calendarOf, composeGlance, describeBlock, factIndex, nextRunId, parseWidget, widgetMarkdown } from "@valueflow/domain";
import type { Agent, AgentRun, AppState, Block, BriefSection, DailyBrief } from "@valueflow/domain";
import { clip } from "./agents.ts";
import { ruleScores } from "./evals.ts";
import { extractJson } from "./llm.ts";
import type { ChatMessage, Llm } from "./llm.ts";
import { promptVersion } from "./prompts.ts";
import { insertBrief, insertRun, loadState, updateRun, upsertScore } from "./repo.ts";

export const MAX_SECTIONS = 6;

/**
 * Models like Title Case Headlines; readers do not. When most words are
 * capitalised, lower the ones that are plain words, keeping the first word,
 * acronyms, ids (R1, MS-21, PRJ-4), and project names as written.
 */
export const sentenceCase = (headline: string, keep: string[] = []): string => {
  const words = headline.split(/\s+/);
  // Judge the style on plain words only: ids, acronyms, and numbers are capitalised either way.
  const plain = words.slice(1).filter((w) => /^[A-Za-z][a-z]/.test(w) && !/[A-Z]{2,}|\d/.test(w));
  const capitalised = plain.filter((w) => /^[A-Z]/.test(w)).length;
  if (plain.length < 2 || capitalised / plain.length < 0.6) return headline;
  // Project names keep their own casing ("Sector report generation", "IMA").
  const casing = new Map(keep.flatMap((k) => k.split(/\s+/)).map((k) => [k.toLowerCase(), k]));
  return words
    .map((w, i) => {
      if (i === 0 || /[A-Z]{2,}|\d/.test(w)) return w;
      const core = w.replace(/[^\w]/g, "");
      const own = casing.get(core.toLowerCase());
      return own ? w.replace(core, own) : w.toLowerCase();
    })
    .join(" ");
};

/** The reader, the signals the composer found, and the ids a widget may point at. */
export const curatorContext = (state: AppState, blocks: Block[]): string => {
  const user = state.workspace.user;
  const owned = state.projects.flatMap((p) => p.governance.filter((g) => g.owner === user.ini && g.status !== "approved" && g.status !== "na").map((g) => `${p.name}: ${g.name} (${g.status})`));
  const pending = state.proposals.filter((p) => p.state === "pending");
  return [
    `# Reader: ${user.name} (${user.ini}), as of ${state.asOf.slice(0, 10)}${state.workspace.lastGlanceAt ? `; last opened Glance ${state.workspace.lastGlanceAt.slice(0, 16).replace("T", " ")}` : "; first visit"}`,
    `Owns ${owned.length} open governance item${owned.length === 1 ? "" : "s"}${owned.length ? `: ${owned.slice(0, 6).join("; ")}` : ""}. ${pending.length} proposal${pending.length === 1 ? "" : "s"} waiting on a decision.`,
    `\n# Signals the composer found (${blocks.length}), most urgent first. Every number you write must come from here.`,
    ...blocks.map((b) => `- ${describeBlock(b)}`),
    `\n# Ids a widget may point at`,
    factIndex(state),
  ].join("\n");
};

const WIDGET_SHAPES = [
  { type: "object", additionalProperties: false, properties: { type: { type: "string", enum: ["none"] } }, required: ["type"] },
  { type: "object", additionalProperties: false, properties: { type: { type: "string", enum: ["metric"] }, proj: { type: "string" }, mid: { type: "string" }, xid: { type: "string" } }, required: ["type", "proj", "mid", "xid"] },
  { type: "object", additionalProperties: false, properties: { type: { type: "string", enum: ["gates"] }, proj: { type: "string" }, mid: { type: "string" } }, required: ["type", "proj", "mid"] },
  { type: "object", additionalProperties: false, properties: { type: { type: "string", enum: ["release"] }, proj: { type: "string" }, rid: { type: "string" } }, required: ["type", "proj", "rid"] },
  { type: "object", additionalProperties: false, properties: { type: { type: "string", enum: ["governance"] }, proj: { type: "string" } }, required: ["type", "proj"] },
  { type: "object", additionalProperties: false, properties: { type: { type: "string", enum: ["value"] }, proj: { type: "string" }, dim: { type: "string", enum: ["fte", "time"] } }, required: ["type", "proj", "dim"] },
  { type: "object", additionalProperties: false, properties: { type: { type: "string", enum: ["proposals"] }, ids: { type: "array", maxItems: 6, items: { type: "string" } } }, required: ["type", "ids"] },
  { type: "object", additionalProperties: false, properties: { type: { type: "string", enum: ["ci"] }, proj: { type: "string" }, repo: { type: "string" }, number: { type: "integer" } }, required: ["type", "proj", "repo", "number"] },
  { type: "object", additionalProperties: false, properties: { type: { type: "string", enum: ["upcoming"] }, days: { type: "integer", minimum: 1, maximum: 90 } }, required: ["type", "days"] },
  { type: "object", additionalProperties: false, properties: { type: { type: "string", enum: ["activity"] }, hours: { type: "integer", minimum: 1, maximum: 336 } }, required: ["type", "hours"] },
  { type: "object", additionalProperties: false, properties: { type: { type: "string", enum: ["table"] }, columns: { type: "array", minItems: 2, maxItems: 6, items: { type: "string" } }, rows: { type: "array", minItems: 1, maxItems: 12, items: { type: "array", items: { type: "string" } } } }, required: ["type", "columns", "rows"] },
];

const BRIEF_SCHEMA = {
  name: "daily_brief",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      headline: { type: "string", description: "One plain sentence under 120 characters: the single thing the reader must know this morning." },
      sections: {
        type: "array",
        minItems: 1,
        maxItems: MAX_SECTIONS,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            text: { type: "string", description: "One short paragraph in markdown (bold the thing it is about); numbers exact; under 60 words." },
            widget: { anyOf: WIDGET_SHAPES },
          },
          required: ["text", "widget"],
        },
      },
    },
    required: ["headline", "sections"],
  },
};

export const buildCuratorMessages = (agent: Agent, state: AppState, blocks: Block[]): ChatMessage[] => [
  {
    role: "system",
    content: [
      `You are ${agent.name}, who writes one person's daily brief in ValueFlow, an AI-project delivery platform. The brief says what they need to know this morning and nothing else, from the signals a deterministic composer found. You never invent a number, a name, or a fact.`,
      `Write a headline and ${MAX_SECTIONS} sections at most, most urgent first: what needs their decision, then what is at risk, then what moved. Skip anything that would repeat another section. Under 60 words per section.`,
      `Under a section, add one widget when a visual says it better than prose, otherwise {"type":"none"}. Widgets: ${WIDGET_TYPES.join(", ")}. Prefer a widget over listing numbers: a gate under threshold → gates or metric; a blocked release → release; missing governance → governance; value against target → value; proposals waiting → proposals with their ids; a failing PR → ci; dated things → upcoming; what happened → activity. Use a table only for a comparison the other widgets cannot show, with cells that repeat figures from the signals exactly.`,
      "Widget ids must come from the id list; a widget that points at nothing is dropped.",
      ...(agent.prompt ? [`\nAdditional instructions from the workspace:\n${agent.prompt}`] : []),
      'Reply with a JSON object: {"headline": string, "sections": [{"text": string, "widget": {...}}]}.',
    ].join("\n"),
  },
  { role: "user", content: curatorContext(state, blocks) },
];

export interface CurateOptions {
  benchmark?: string | undefined;
}

/** Write the reader's daily brief; returns the run, with the brief stored when it succeeded. */
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
    instruction: `Daily brief for ${state.workspace.user.name}`,
    summary: `${agent.name} is writing the brief…`,
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
    const done: AgentRun = { ...run, state: "done", finishedAt: new Date().toISOString(), summary: "Nothing to brief: the composer found no signals", output: "The workspace has no signals today, so Glance shows the empty state.", latencyMs: Date.now() - started };
    updateRun(db, done);
    return done;
  }
  try {
    const res = await llm.chat(messages, { jsonSchema: BRIEF_SCHEMA, maxTokens: 2500, temperature: 0.2, model: agent.model });
    const raw = extractJson(res.content);
    const o = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    const headline = typeof o.headline === "string" ? sentenceCase(clip(o.headline.trim(), 140), state.projects.flatMap((p) => [p.name, p.key])) : "";
    const rawSections = Array.isArray(o.sections) ? o.sections : [];
    let widgetsReturned = 0;
    let widgetsKept = 0;
    const sections: BriefSection[] = [];
    for (const item of rawSections.slice(0, MAX_SECTIONS)) {
      if (typeof item !== "object" || item === null) continue;
      const sec = item as Record<string, unknown>;
      const text = typeof sec.text === "string" ? sec.text.trim() : "";
      if (!text) continue;
      const wantsWidget = typeof sec.widget === "object" && sec.widget !== null && (sec.widget as Record<string, unknown>).type !== "none";
      if (wantsWidget) widgetsReturned += 1;
      const widget = wantsWidget ? parseWidget(sec.widget, state) : null;
      if (widget) widgetsKept += 1;
      sections.push({ text, widget });
    }
    if (!headline || sections.length === 0) throw new Error(`reply had ${headline ? "no sections" : "no headline"}`);
    const body = [`# ${headline}`, ...sections.map((s) => `${s.text}${s.widget ? `\n\n${widgetMarkdown(s.widget)}` : ""}`)].join("\n\n");
    const finished: AgentRun = { ...run, state: "done", finishedAt: new Date().toISOString(), summary: headline, output: body, model: res.model, latencyMs: Date.now() - started, promptTokens: res.usage?.prompt ?? null, completionTokens: res.usage?.completion ?? null };
    updateRun(db, finished);
    if (!options.benchmark) {
      const brief: DailyBrief = { runId: run.id, at: finished.finishedAt ?? now.toISOString(), stateHash: blocksHash(blocks), headline, sections, model: res.model };
      insertBrief(db, state.workspace.user.ini, brief);
    }
    for (const s of ruleScores({ run: finished, briefing, proposalsReturned: 0, proposalsKept: 0, placements: { returned: widgetsReturned, kept: widgetsKept } }, finished.finishedAt ?? now.toISOString())) upsertScore(db, s);
    return finished;
  } catch (e) {
    const failed: AgentRun = { ...run, state: "failed", finishedAt: new Date().toISOString(), summary: `${agent.name} could not write the brief`, error: e instanceof Error ? e.message : String(e), latencyMs: Date.now() - started };
    updateRun(db, failed);
    return failed;
  }
};

/** Whether the stored brief still matches what the composer finds now. */
export const briefIsCurrent = (state: AppState): boolean => {
  if (!state.brief) return false;
  return state.brief.stateHash === blocksHash(composeGlance(state, calendarOf(state)));
};
