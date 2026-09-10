import type { Agent } from "../types.ts";

export const AGENTS: Agent[] = [
  {
    id: "slider", name: "Slider", grad: "linear-gradient(135deg,#F5A623,#F76B1C)",
    purpose: "Generates slide decks from project state — value reviews, committee pre-reads, exec updates",
    status: "idle", model: "claude-sonnet", runs: 34, success: 97, last: "2h ago", owner: "AM",
    caps: ["Value review decks", "AIRC pre-reads", "Release readouts", "Brand template aware"],
    sessions: [
      { when: "2h ago", state: "done", text: "Q3 value review deck — burn-up, gates, and R2 readiness for OBJ-4", proj: "onboarding", tab: "value" },
      { when: "1d ago", state: "done", text: "AIRC pre-read deck for October committee submission", proj: "sector", tab: "governance" },
      { when: "3d ago", state: "done", text: "R1 Mapping GA retrospective readout (12 slides)", proj: "onboarding", tab: "roadmap" },
    ],
  },
  {
    id: "comma", name: "Comma", grad: "linear-gradient(135deg,#39C5CF,#2F80ED)",
    purpose: "Drafts communications — release notes, stakeholder updates, decision memos, meeting follow-ups",
    status: "working", model: "claude-sonnet", runs: 58, success: 94, last: "now", owner: "JL",
    caps: ["Release notes", "Decision memos", "Stakeholder updates", "Tone-matched to audience"],
    sessions: [
      { when: "now", state: "working", text: "Drafting SME recall-gate decision memo (88% vs 90% base threshold)", proj: "ima", tab: "value" },
      { when: "5h ago", state: "done", text: "Weekly stakeholder update — portfolio value + blocked release summary", proj: "onboarding", tab: "value" },
      { when: "2d ago", state: "done", text: "UAT invitation email for ingestion canary cohort", proj: "onboarding", tab: "roadmap" },
    ],
  },
  {
    id: "nova", name: "Nova", grad: "linear-gradient(135deg,#8B5CF0,#D253CE)",
    purpose: "Ideation and brainstorming partner — divergent options, prior art, and structured concept development",
    status: "idle", model: "claude-opus", runs: 21, success: 90, last: "1d ago", owner: "AM",
    caps: ["Divergent ideation", "Prior-art scans", "Concept scoring", "Workshop facilitation"],
    sessions: [
      { when: "1d ago", state: "done", text: "12 concepts for reviewer workbench v2 — ranked by throughput impact", proj: "ima", tab: "value" },
      { when: "4d ago", state: "done", text: "Eval strategy options for entity resolution (golden set vs synthetic)", proj: "onboarding", tab: "value" },
      { when: "6d ago", state: "done", text: "Brainstorm: analyst feedback loops for draft quality rating", proj: "sector", tab: "value" },
    ],
  },
  {
    id: "audie", name: "Audie", grad: "linear-gradient(135deg,#4CC38A,#1F9D6C)",
    purpose: "Scans for improvement opportunities — security auditability, code quality and habits, and PM practice gaps",
    status: "scheduled", model: "claude-sonnet", runs: 46, success: 92, last: "9h ago", owner: "RS",
    caps: ["Audit-trail gaps", "Code-quality habits", "Governance drift", "PM practice review"],
    sessions: [
      { when: "9h ago", state: "done", text: "Flagged secrets-handling pattern in doc-ingest-pipeline; suggested vault refs + rotation policy", proj: "onboarding", tab: "development" },
      { when: "1d ago", state: "attention", text: "Rule activations in ima-rule-extractor lack immutable audit log — Tier 1 exposure", proj: "ima", tab: "governance" },
      { when: "2d ago", state: "done", text: "PM practice: 40% of shipped milestones missing linked UAT evidence; proposed checklist automation", proj: "onboarding", tab: "governance" },
      { when: "3d ago", state: "done", text: "Coverage habit: sector-report-agents merges below 60% — suggested ratchet rule in CI", proj: "sector", tab: "development" },
    ],
  },
];
