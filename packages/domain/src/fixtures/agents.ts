// Workspace agents and a sample of their recent runs. Run times are offsets
// from the state's `asOf`; a real run is produced by the server's agent
// runner calling the configured LLM.

import type { Agent, AgentRun, EvalCase, ProjectTab, Rule, RunState } from "../types.ts";

const HOUR = 3_600_000;

export const AGENTS: Agent[] = [
  {
    id: "slider",
    name: "Slider",
    grad: "linear-gradient(135deg,#F5A623,#F76B1C)",
    purpose: "Generates slide decks from project state — value reviews, committee pre-reads, exec updates",
    kind: "deck",
    model: null,
    owner: "AM",
    caps: ["Value review decks", "AIRC pre-reads", "Release readouts", "Brand template aware"],
    schedule: null,
    prompt: null,
  },
  {
    id: "comma",
    name: "Comma",
    grad: "linear-gradient(135deg,#39C5CF,#2F80ED)",
    purpose: "Drafts communications — release notes, stakeholder updates, decision memos, meeting follow-ups",
    kind: "comms",
    model: null,
    owner: "JL",
    caps: ["Release notes", "Decision memos", "Stakeholder updates", "Tone-matched to audience"],
    schedule: null,
    prompt: null,
  },
  {
    id: "nova",
    name: "Nova",
    grad: "linear-gradient(135deg,#8B5CF0,#D253CE)",
    purpose: "Ideation and brainstorming partner — divergent options, prior art, and structured concept development",
    kind: "ideation",
    model: null,
    owner: "AM",
    caps: ["Divergent ideation", "Prior-art scans", "Concept scoring", "Workshop facilitation"],
    schedule: null,
    prompt: null,
  },
  {
    id: "audie",
    name: "Audie",
    grad: "linear-gradient(135deg,#4CC38A,#1F9D6C)",
    purpose: "Scans for improvement opportunities — security auditability, code quality and habits, and PM practice gaps",
    kind: "audit",
    model: null,
    owner: "RS",
    caps: ["Audit-trail gaps", "Code-quality habits", "Governance drift", "PM practice review"],
    schedule: "nightly",
    prompt: null,
  },
  {
    id: "ask",
    name: "Ask",
    grad: "linear-gradient(135deg,#EEEFF1,#8A8F98)",
    purpose: "Answers questions about the whole workspace, points at the right page, and drafts proposals from the conversation",
    kind: "chat",
    model: null,
    owner: "AM",
    caps: ["Cross-project questions", "Where to look", "Draft proposals", "Every answer cites the briefing"],
    schedule: null,
    prompt: null,
  },
  {
    id: "sentry",
    name: "Sentry",
    grad: "linear-gradient(135deg,#E3B341,#E5534B)",
    purpose: "Checks every standing rule against each project nightly and proposes what the rule says should happen",
    kind: "rules",
    model: null,
    owner: "AM",
    caps: ["Plain-language rules", "Nightly checks", "Proposals per rule", "Earned autonomy"],
    schedule: "nightly",
    prompt: null,
  },
  {
    id: "monday",
    name: "Monday",
    grad: "linear-gradient(135deg,#39C5CF,#4CC38A)",
    purpose: "Writes your weekly brief: what moved, what is blocked, decisions waiting on you, and proposals pending",
    kind: "brief",
    model: null,
    owner: "AM",
    caps: ["Monday brief", "What moved", "Decisions waiting", "Webhook delivery"],
    schedule: "weekly",
    prompt: null,
  },
  {
    id: "coach",
    name: "Coach",
    grad: "linear-gradient(135deg,#8B96F8,#6E7BF2)",
    purpose: "Reads each agent's low-scoring runs, judge critiques, and ratings, then proposes a prompt change to benchmark",
    kind: "tuner",
    model: null,
    owner: "AM",
    caps: ["Reads critiques", "Proposes prompt edits", "Benchmarks on accept", "Version history"],
    schedule: "weekly",
    prompt: null,
  },
  {
    id: "scout",
    name: "Scout",
    grad: "linear-gradient(135deg,#D253CE,#F5A623)",
    purpose: "Benchmarks candidate models against each agent's current one and proposes a switch when the numbers justify it",
    kind: "scout",
    model: null,
    owner: "AM",
    caps: ["Candidate models", "Same cases, same judge", "Quality vs cost", "Proposes switches"],
    schedule: "weekly",
    prompt: null,
  },
  {
    id: "curator",
    name: "Curator",
    grad: "linear-gradient(135deg,#8B96F8,#39C5CF)",
    purpose: "Lays out Glance for the reader: which of the composer's cards to show, where, and why they matter today",
    kind: "curator",
    model: null,
    owner: "AM",
    caps: ["Picks from found cards only", "Decide / watch / know", "One line of why", "Re-curates when facts move"],
    schedule: "nightly",
    prompt: null,
  },
];

/** The built-in conversational agent; installed on boot if missing. */
export const ASK_AGENT = AGENTS.find((a) => a.kind === "chat") as Agent;

/** Standing rules the sample workspace starts with; a person can edit, disable, or delete them. */
export const RULES = (asOf: string): Rule[] => {
  const at = new Date(new Date(asOf).getTime() - 14 * 86_400_000).toISOString();
  return [
    { id: "rule-1", text: "If a Tier 1 project has a failing build on a release-critical repo for more than two days, add a calendar event for a fix-by decision within a week and flag me.", proj: null, enabled: true, auto: false, owner: "AM", createdAt: at },
    { id: "rule-2", text: "If a governance item is described as complete in recent activity but is still marked In review or Draft, propose moving it to Approved.", proj: null, enabled: true, auto: false, owner: "RS", createdAt: at },
    { id: "rule-3", text: "When a milestone in eval has every metric above its base gate, propose marking it shipped.", proj: null, enabled: true, auto: false, owner: "AM", createdAt: at },
  ];
};

/** Fixed questions the benchmark re-runs so prompt and model changes can be compared. */
export const EVAL_CASES: EvalCase[] = [
  { id: "slider-onboarding-q3", agentId: "slider", proj: "onboarding", instruction: "A Q3 value review deck for the steering group.", expectations: ["States 15% of the 40% FTE target is realized", "Names R2 Ingestion GA as at risk with 1 of 4 criteria met", "Lists Document ingestion pipeline as below its base gate"] },
  { id: "slider-ima-airc", agentId: "slider", proj: "ima", instruction: "An AIRC pre-read for the quarterly Tier 1 re-review.", expectations: ["Notes the project is Tier 1 with quarterly re-review", "Shows rule recall 86% against the 88% base gate", "Lists the missing governance items: Product SLA, UAT process, User & ops documentation"] },
  { id: "comma-onboarding-update", agentId: "comma", proj: "onboarding", instruction: "This week's stakeholder update.", expectations: ["Mentions the failed build #1148 on doc-ingest-pipeline", "Mentions ops documentation moving to In review", "Stays under 350 words"] },
  { id: "comma-ima-memo", agentId: "comma", proj: "ima", instruction: "A decision memo on the recall gate: 88% base as set, or 90% as the SMEs want.", expectations: ["States current recall is 86%", "Lays out both thresholds with a consequence for each", "Ends with a clear recommendation and who decides"] },
  { id: "nova-sector-quality", agentId: "nova", proj: "sector", instruction: "Options to lift analyst quality rating without adding reviewer load.", expectations: ["References the 64% analyst quality rating against its gate", "Gives at least 8 distinct options with effort sizes", "Ties options to the Draft generation pipeline milestone"] },
  { id: "audie-ima-audit", agentId: "audie", proj: "ima", instruction: "Full audit ahead of R1 shadow mode.", expectations: ["Flags Tier 1 exposure with attention set", "Cites the recall gap (86% vs 88%)", "Names the pending security review and model risk assessment", "Proposes at least one concrete change"] },
  { id: "audie-sector-habits", agentId: "audie", proj: "sector", instruction: "Code-quality and delivery habits review.", expectations: ["Cites 58% coverage on sector-report-agents", "Mentions the flaky failing build", "Recommends a concrete CI or review practice"] },
  { id: "ask-workspace-blocked", agentId: "ask", proj: "ima", instruction: "Why is R1 blocked and what would unblock it fastest?", expectations: ["Lists the unmet R1 criteria", "Identifies the recall gate as the closest fix", "Links to the IMA roadmap or value page"] },
  { id: "curator-morning", agentId: "curator", proj: "ima", instruction: "", expectations: ["Shows the blocked R1 Shadow mode release under watch or decide", "Shows the Tier 1 governance gaps card", "Every card's reason cites a fact from that card and nothing else", "Uses at most six cards with a headline under 120 characters"] },
];

interface SampleRun {
  agentId: string;
  hoursAgo: number;
  state: RunState;
  proj: string;
  tab: ProjectTab;
  summary: string;
  instruction?: string;
}

const SAMPLE_RUNS: SampleRun[] = [
  { agentId: "slider", hoursAgo: 2, state: "done", proj: "onboarding", tab: "value", summary: "Q3 value review deck — burn-up, gates, and R2 readiness for PRJ-4" },
  { agentId: "slider", hoursAgo: 26, state: "done", proj: "sector", tab: "governance", summary: "AIRC pre-read deck for October committee submission" },
  { agentId: "slider", hoursAgo: 74, state: "done", proj: "onboarding", tab: "roadmap", summary: "R1 Mapping GA retrospective readout (12 slides)" },
  { agentId: "comma", hoursAgo: 0.1, state: "working", proj: "ima", tab: "value", summary: "Drafting SME recall-gate decision memo (88% vs 90% base threshold)", instruction: "Decision memo on the recall gate threshold" },
  { agentId: "comma", hoursAgo: 5, state: "done", proj: "onboarding", tab: "value", summary: "Weekly stakeholder update — portfolio value + blocked release summary" },
  { agentId: "comma", hoursAgo: 50, state: "done", proj: "onboarding", tab: "roadmap", summary: "UAT invitation email for ingestion canary cohort" },
  { agentId: "nova", hoursAgo: 25, state: "done", proj: "ima", tab: "value", summary: "12 concepts for reviewer workbench v2 — ranked by throughput impact" },
  { agentId: "nova", hoursAgo: 98, state: "done", proj: "onboarding", tab: "value", summary: "Eval strategy options for entity resolution (golden set vs synthetic)" },
  { agentId: "nova", hoursAgo: 146, state: "done", proj: "sector", tab: "value", summary: "Brainstorm: analyst feedback loops for draft quality rating" },
  { agentId: "audie", hoursAgo: 9, state: "done", proj: "onboarding", tab: "development", summary: "Flagged secrets-handling pattern in doc-ingest-pipeline; suggested vault refs + rotation policy" },
  { agentId: "audie", hoursAgo: 27, state: "attention", proj: "ima", tab: "governance", summary: "Rule activations in ima-rule-extractor lack immutable audit log — Tier 1 exposure" },
  { agentId: "audie", hoursAgo: 52, state: "done", proj: "onboarding", tab: "governance", summary: "PM practice: 40% of shipped milestones missing linked UAT evidence; proposed checklist automation" },
  { agentId: "audie", hoursAgo: 76, state: "done", proj: "sector", tab: "development", summary: "Coverage habit: sector-report-agents merges below 60% — suggested ratchet rule in CI" },
];

/** Sample runs as they would be stored after happening at the given offsets from `asOf`; oldest gets the lowest id. */
export const RUNS = (asOf: string): AgentRun[] => {
  const base = new Date(asOf).getTime();
  const ordered = [...SAMPLE_RUNS].sort((a, b) => b.hoursAgo - a.hoursAgo);
  return ordered
    .map((r, i): AgentRun => {
      const startedAt = new Date(base - r.hoursAgo * HOUR).toISOString();
      const running = r.state === "working" || r.state === "queued";
      return {
        id: `run-${i + 1}`,
        agentId: r.agentId,
        proj: r.proj,
        tab: r.tab,
        state: r.state,
        startedAt,
        finishedAt: running ? null : new Date(base - r.hoursAgo * HOUR + 40_000).toISOString(),
        instruction: r.instruction ?? null,
        summary: r.summary,
        output: running ? "" : `${r.summary}\n\n(Sample run. Real runs store the full response from the configured model.)`,
        model: running ? null : "sample",
        error: null,
        promptVersion: null,
        latencyMs: running ? null : 40_000,
        promptTokens: null,
        completionTokens: null,
        benchmark: null,
        rating: null,
        ratingNote: null,
      };
    })
    .sort((a, b) => (b.startedAt < a.startedAt ? -1 : b.startedAt > a.startedAt ? 1 : a.id < b.id ? -1 : 1));
};
