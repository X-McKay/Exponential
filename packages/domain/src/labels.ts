import type { AgentKind, AgentStatus, CheckStatus, FeedType, GovStatus, MilestoneStatus, RiskTier, RunStep } from "./types.ts";

export const STATUS_LABEL: Record<MilestoneStatus, string> = {
  backlog: "Backlog",
  progress: "In progress",
  eval: "In eval",
  shipped: "Shipped",
};

export const GSTATUS_LABEL: Record<GovStatus, string> = {
  approved: "Approved",
  in_review: "In review",
  draft: "Draft",
  missing: "Missing",
  na: "N/A",
};

export const TIER_LABEL: Record<RiskTier, string> = {
  1: "Tier 1 · High risk",
  2: "Tier 2 · Medium risk",
  3: "Tier 3 · Low risk",
};

export const FEED_LABEL: Record<FeedType, string> = {
  build: "CI",
  eval: "Eval",
  merge: "Code",
  deploy: "Deploy",
  gov: "Governance",
  ship: "Milestone",
};

export const AGENT_STATUS_LABEL: Record<AgentStatus, string> = {
  working: "Working…",
  idle: "Idle",
  scheduled: "Scheduled",
};

export const CHECK_ICON: Record<CheckStatus, string> = { pass: "✓", fail: "✗", running: "◌" };

export const AGENT_KIND_LABEL: Record<AgentKind, string> = { deck: "Decks", comms: "Communications", ideation: "Ideation", audit: "Audit", chat: "Conversation", rules: "Standing rules", brief: "Weekly brief", tuner: "Prompt tuning", scout: "Model scouting", curator: "Glance curation", setup: "Project setup" };

/** What each step reads as while it is the latest thing a run did. */
export const STEP_LABEL: Record<RunStep, string> = {
  briefing: "Building the briefing",
  request: "Waiting for the model",
  reply: "Reply received",
  retry: "Reply was cut off, asking again",
  parsed: "Reading the reply",
  proposals: "Validating proposals",
  applied: "Applying a trusted rule",
  scored: "Scoring against the rules",
  delivered: "Delivering",
  judge: "Judge is grading",
  judged: "Judged",
  done: "Done",
  failed: "Failed",
};

/** Re-review cadence implied by a project's AI risk tier. */
export const reReviewCadence = (tier: RiskTier | null): string => {
  switch (tier) {
    case 1:
      return "Quarterly";
    case 2:
      return "Annual";
    case 3:
    case null:
      return "At stage change";
  }
};
