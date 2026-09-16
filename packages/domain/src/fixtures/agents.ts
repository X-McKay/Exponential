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
    owner: "JA",
    caps: ["Value review decks", "Committee pre-reads", "Release readouts", "Brand template aware"],
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
    owner: "AR",
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
    owner: "JA",
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
    owner: "TO",
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
    owner: "JA",
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
    owner: "JA",
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
    owner: "JA",
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
    owner: "JA",
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
    owner: "JA",
    caps: ["Candidate models", "Same cases, same judge", "Quality vs cost", "Proposes switches"],
    schedule: "weekly",
    prompt: null,
  },
  {
    id: "curator",
    name: "Curator",
    grad: "linear-gradient(135deg,#8B96F8,#39C5CF)",
    purpose: "Writes the reader's daily brief from the signals the composer found, with a widget wherever a visual earns its place",
    kind: "curator",
    model: null,
    owner: "JA",
    caps: ["Facts from signals only", "Widgets by id", "Tables when warranted", "Rewrites when facts move"],
    schedule: "nightly",
    prompt: null,
  },
  {
    id: "setup",
    name: "Setup",
    grad: "linear-gradient(135deg,#6E7BF2,#39C5CF)",
    purpose: "Drafts a project from documents and, later, stages changes to the record when new documents arrive; nothing is applied until you approve it in the inbox",
    kind: "setup",
    model: null,
    owner: "JA",
    caps: ["Charters and decks", "Drafts with rationale", "Staged updates", "Approval in the inbox"],
    schedule: null,
    prompt: null,
  },
  {
    id: "project-manager",
    name: "Project Manager",
    grad: "linear-gradient(135deg,#8B5CF0,#6254CE)",
    purpose: "Reviews project health, proposes evidence-backed plans, and follows approved commitments",
    kind: "audit",
    model: null,
    owner: "JA",
    caps: ["Project assessment", "Blocker analysis", "Action planning", "Commitment follow-through", "Communications briefs"],
    schedule: null,
    prompt: null,
  },
];

/** The built-in conversational agent; installed on boot if missing. */
export const ASK_AGENT = AGENTS.find((a) => a.kind === "chat") as Agent;

/** Standing rules the sample workspace starts with; a person can edit, disable, or delete them. */
export const RULES = (asOf: string): Rule[] => {
  const at = new Date(new Date(asOf).getTime() - 14 * 86_400_000).toISOString();
  return [
    { id: "rule-1", text: "If a Tier 1 project has a failing build on a release-critical repo for more than two days, add a calendar event for a fix-by decision within a week and flag me.", proj: null, enabled: true, auto: false, owner: "JA", createdAt: at },
    { id: "rule-2", text: "If a governance item is described as complete in recent activity but is still marked In review or Draft, propose moving it to Approved.", proj: null, enabled: true, auto: false, owner: "TO", createdAt: at },
    { id: "rule-3", text: "When a milestone in eval has every metric above its base gate, propose marking it shipped.", proj: null, enabled: true, auto: false, owner: "JA", createdAt: at },
    { id: "rule-4", text: "If a shipped milestone's metric falls below its base gate in a monthly quality sample, add a calendar event for a drift review within two weeks.", proj: "meetings", enabled: true, auto: false, owner: "HS", createdAt: at },
  ];
};

/** Fixed questions the benchmark re-runs so prompt and model changes can be compared. */
export const EVAL_CASES: EvalCase[] = [
  { id: "slider-invoice-q3", agentId: "slider", proj: "invoice", instruction: "A Q3 value review deck for the steering group.", expectations: ["States 15% of the 40% FTE target is eligible", "Names R2 Matching GA as at risk with 1 of 4 criteria met", "Lists Purchase-order matching as below its base gate"] },
  { id: "slider-clauses-committee", agentId: "slider", proj: "clauses", instruction: "A committee pre-read for the quarterly Tier 1 re-review.", expectations: ["Notes the project is Tier 1 with quarterly re-review", "Shows clause recall 86% against the 88% base gate", "Lists the missing governance items: Service level agreement, User acceptance testing, User and operator documentation"] },
  { id: "comma-invoice-update", agentId: "comma", proj: "invoice", instruction: "This week's stakeholder update.", expectations: ["Mentions the failed build #1148 on invoice-po-matcher", "Mentions operator documentation moving to In review", "Stays under 350 words"] },
  { id: "comma-clauses-memo", agentId: "comma", proj: "clauses", instruction: "A decision memo on the recall gate: 88% base as set, or 90% as the SMEs want.", expectations: ["States current recall is 86%", "Lays out both thresholds with a consequence for each", "Ends with a clear recommendation and who decides"] },
  { id: "nova-search-quality", agentId: "nova", proj: "search", instruction: "Options to lift the reviewer quality rating without adding reviewer load.", expectations: ["References the 64% reviewer quality rating against its gate", "Gives at least 8 distinct options with effort sizes", "Ties options to the Grounded answer pipeline milestone"] },
  { id: "audie-clauses-audit", agentId: "audie", proj: "clauses", instruction: "Full audit ahead of R1 shadow mode.", expectations: ["Flags Tier 1 exposure with attention set", "Cites the recall gap (86% vs 88%)", "Names the pending security review and model risk assessment", "Proposes at least one concrete change"] },
  { id: "audie-search-habits", agentId: "audie", proj: "search", instruction: "Code-quality and delivery habits review.", expectations: ["Cites 58% coverage on knowledge-search-agents", "Mentions the flaky failing build", "Recommends a concrete CI or review practice"] },
  { id: "audie-triage-readiness", agentId: "audie", proj: "triage", instruction: "Is the support pilot ready to go live?", expectations: ["States every R1 criterion is met", "Names operator documentation as the one missing governance item", "Does not claim the release has shipped"] },
  { id: "ask-workspace-blocked", agentId: "ask", proj: "clauses", instruction: "Why is R1 blocked and what would unblock it fastest?", expectations: ["Lists the unmet R1 criteria", "Identifies the recall gate as the closest fix", "Links to the Contract Clause Review roadmap or value page"] },
  { id: "curator-morning", agentId: "curator", proj: "clauses", instruction: "", expectations: ["Covers the blocked R1 Shadow mode release under top of mind with an action link", "Covers the Tier 1 governance gaps", "Every number in the prose appears in the signals", "Every item is at most two sentences and no item repeats another's fact"] },
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
  { agentId: "slider", hoursAgo: 2, state: "done", proj: "invoice", tab: "value", summary: "Q3 value review deck — burn-up, gates, and R2 readiness for PRJ-4" },
  { agentId: "slider", hoursAgo: 26, state: "done", proj: "search", tab: "governance", summary: "Committee pre-read deck for the October submission" },
  { agentId: "slider", hoursAgo: 74, state: "done", proj: "invoice", tab: "roadmap", summary: "R1 Extraction GA retrospective readout (12 slides)" },
  { agentId: "comma", hoursAgo: 0.1, state: "working", proj: "clauses", tab: "value", summary: "Drafting SME recall-gate decision memo (88% vs 90% base threshold)", instruction: "Decision memo on the recall gate threshold" },
  { agentId: "comma", hoursAgo: 5, state: "done", proj: "invoice", tab: "value", summary: "Weekly stakeholder update — portfolio value and blocked release summary" },
  { agentId: "comma", hoursAgo: 50, state: "done", proj: "triage", tab: "roadmap", summary: "Pilot go-live announcement for the second support queue" },
  { agentId: "nova", hoursAgo: 25, state: "done", proj: "clauses", tab: "value", summary: "12 concepts for reviewer workbench v2 — ranked by throughput impact" },
  { agentId: "nova", hoursAgo: 98, state: "done", proj: "invoice", tab: "value", summary: "Eval strategy options for duplicate detection (golden set vs synthetic)" },
  { agentId: "nova", hoursAgo: 146, state: "done", proj: "search", tab: "value", summary: "Brainstorm: reviewer feedback loops for the answer quality rating" },
  { agentId: "audie", hoursAgo: 9, state: "done", proj: "invoice", tab: "development", summary: "Flagged secrets-handling pattern in invoice-po-matcher; suggested vault references and a rotation policy" },
  { agentId: "audie", hoursAgo: 27, state: "attention", proj: "clauses", tab: "governance", summary: "Clause activations in clause-extractor lack an immutable audit log — Tier 1 exposure" },
  { agentId: "audie", hoursAgo: 52, state: "done", proj: "invoice", tab: "governance", summary: "PM practice: 40% of shipped milestones missing linked UAT evidence; proposed checklist automation" },
  { agentId: "audie", hoursAgo: 76, state: "done", proj: "search", tab: "development", summary: "Coverage habit: knowledge-search-agents merges below 60% — suggested ratchet rule in CI" },
  { agentId: "audie", hoursAgo: 120, state: "done", proj: "meetings", tab: "governance", summary: "Steady-state review: annual committee re-review due in November, no drift in the monthly sample" },
  { agentId: "setup", hoursAgo: 170, state: "done", proj: "triage", tab: "overview", summary: "Staged 3 changes from 1 document: pilot charter v3 renames the routing milestone and adds a data engineer" },
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
