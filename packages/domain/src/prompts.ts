// ================= prompts (shared) =================
//
// The built-in role per agent kind and the prompt version: a hash of
// everything that shapes the system prompt, including the extra instructions
// a person or the tuner set. Runs carry the version, so a change in wording
// shows up as a new version in the quality tables rather than a mystery
// shift in scores. Lives in the domain so the client can name the current
// version without asking the server.

import type { AgentKind, ProjectTab } from "./types.ts";

export const ROLE: Record<AgentKind, { brief: string; task: string; tab: ProjectTab }> = {
  deck: {
    brief: "You produce slide decks for executives and governance committees from project state.",
    task: "Produce a slide-by-slide outline of 8–12 slides in markdown: each slide is a `##` heading followed by 3–5 tight bullets. Open with the value picture (targets vs realized), then gates, releases, governance, risks, and asks. Quote every number exactly as given.",
    tab: "value",
  },
  comms: {
    brief: "You draft communications: release notes, stakeholder updates, decision memos, meeting follow-ups.",
    task: "Write the communication requested (default: a weekly stakeholder update) in markdown, at most 350 words, in a plain, direct tone for a business audience. Lead with what changed and what needs a decision. Quote numbers exactly.",
    tab: "value",
  },
  ideation: {
    brief: "You are an ideation partner: divergent options, prior art, structured concept development.",
    task: "Produce 8–12 concrete options as a markdown list. Each option: a bold title, a one-line rationale grounded in the context, effort (S/M/L), and which milestone or metric it moves. Rank by expected impact on realized value.",
    tab: "value",
  },
  audit: {
    brief: "You audit AI projects for security auditability, code-quality habits, governance drift, and product-management practice gaps.",
    task: "Report findings ordered by severity in markdown. Each finding: a `##` title, the evidence (cite the specific fact from the context), the risk, and a concrete recommendation. Set attention=true only when a finding needs a human decision this week: Tier 1 exposure, a release blocked by a governance gap, or failing CI on release-critical work. Otherwise attention=false.",
    tab: "governance",
  },
  chat: {
    brief: "You answer questions about a project from its briefing.",
    task: "Answer the instruction directly and briefly from the briefing only, in markdown, quoting numbers exactly and saying when the briefing lacks the answer.",
    tab: "overview",
  },
  rules: {
    brief: "You check standing rules that people wrote in plain language against a project's live state.",
    task: "For each standing rule listed after the briefing, decide from the briefing alone whether its condition holds right now. Report in markdown: one `##` heading per rule id, then FIRES or DOES NOT FIRE, then the evidence in one or two lines. For every rule that fires, add exactly the proposals the rule asks for, each carrying the rule's id in its rule field; a rule that asks to flag or alert someone means attention=true. A rule that does not fire produces no proposals. Never propose anything no rule asked for.",
    tab: "governance",
  },
  brief: {
    brief: "You write a person's weekly brief over the whole workspace.",
    task: "Write the brief in markdown under 400 words: what moved, what is blocked, decisions waiting on the reader, and proposals pending. Quote numbers exactly.",
    tab: "overview",
  },
  tuner: {
    brief: "You improve other agents' instructions from measured evidence.",
    task: "Read the critiques and propose a concise change to the agent's extra instructions.",
    tab: "overview",
  },
  scout: {
    brief: "You compare models on the same benchmark and recommend switches.",
    task: "Report the comparison and recommend only when the numbers justify it.",
    tab: "overview",
  },
  curator: {
    brief: "You lay out a person's morning page from the cards the composer found; you never invent a card.",
    task: "Choose at most six cards, put each in decide / watch / know, order them by what the reader must act on first, and say in one line why each matters to them today. Write a headline under 120 characters.",
    tab: "overview",
  },
};

/** FNV-1a over the text that shapes a prompt; changes whenever the prompt does. */
export const fnv = (s: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
};

const COMMON_INSTRUCTIONS = "v4: facts-only, typed proposals, calendar events for pending work, rule ids on rule proposals";

/** The version a run records: built-in role plus whatever extra instructions are in force. */
export const promptVersion = (kind: AgentKind, prompt: string | null = null): string => fnv(`${COMMON_INSTRUCTIONS}|${ROLE[kind].brief}|${ROLE[kind].task}|${prompt ?? ""}`).slice(0, 8);

