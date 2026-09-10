// Workspace agents and a sample of their recent runs. Run times are offsets
// from the state's `asOf`; a real run is produced by the server's agent
// runner calling the configured LLM.

import type { Agent, AgentRun, ProjectTab, RunState } from "../types.ts";

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
  },
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
      };
    })
    .sort((a, b) => (b.startedAt < a.startedAt ? -1 : b.startedAt > a.startedAt ? 1 : a.id < b.id ? -1 : 1));
};
