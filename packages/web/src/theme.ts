// ================= design tokens =================
// Exact palette from the mockup's `C` constant plus per-status colors.

import type { AgentStatus, CheckStatus, FeedType, GovStatus, MilestoneStatus, RiskTier, SessionState } from "@valueflow/domain";
import type { ReleaseTone, Tone } from "@valueflow/domain";

export const C = {
  bg: "#08090A",
  panel: "#0F1012",
  panel2: "#131418",
  line: "#1B1C20",
  line2: "#26272C",
  text: "#EEEFF1",
  mut: "#8A8F98",
  dim: "#767B8A",
  indigo: "#6E7BF2",
  indigoHi: "#8B96F8",
  green: "#4CC38A",
  amber: "#E3B341",
  teal: "#39C5CF",
  red: "#E5534B",
} as const;

export const STATUS_COLOR: Record<MilestoneStatus, string> = {
  backlog: "#5B6070",
  progress: "#E3B341",
  eval: "#7B87F5",
  shipped: "#4CC38A",
};

export const GSTATUS_COLOR: Record<GovStatus, string> = {
  approved: C.green,
  in_review: C.indigoHi,
  draft: C.amber,
  missing: C.red,
  na: C.dim,
};

export const TIER_COLOR: Record<RiskTier, string> = { 1: C.red, 2: C.amber, 3: C.green };

export const FEED_COLOR: Record<FeedType, string> = {
  build: C.red,
  eval: C.amber,
  merge: C.indigoHi,
  deploy: C.teal,
  gov: C.green,
  ship: C.green,
};

export const CHECK_COLOR: Record<CheckStatus, string> = { pass: C.green, fail: C.red, running: C.amber };

export const AGENT_STATUS: Record<AgentStatus, { color: string; pulse: boolean }> = {
  working: { color: C.indigoHi, pulse: true },
  idle: { color: C.dim, pulse: false },
  scheduled: { color: C.teal, pulse: false },
};

export const SESSION_COLOR: Record<SessionState, string> = { done: C.green, working: C.indigoHi, attention: C.amber };

export type ChipTone = "default" | "accent" | "good" | "warn" | "bad";

export const govChipTone = (s: GovStatus): ChipTone => {
  switch (s) {
    case "approved":
      return "good";
    case "in_review":
      return "accent";
    case "draft":
      return "warn";
    case "missing":
      return "bad";
    case "na":
      return "default";
  }
};

export const toneToChip = (t: Tone): ChipTone => {
  switch (t) {
    case "bad":
      return "bad";
    case "warn":
      return "warn";
    case "good":
      return "good";
    case "info":
      return "default";
  }
};

export const releaseToneColor = (t: ReleaseTone): string => {
  switch (t) {
    case "good":
      return C.green;
    case "warn":
      return C.amber;
    case "bad":
      return C.red;
  }
};

/** Border color used by Glance cards per tone. */
export const toneBorder = (t: Tone): string => {
  switch (t) {
    case "bad":
      return "rgba(229,83,75,.35)";
    case "warn":
      return "rgba(227,179,65,.3)";
    case "good":
      return "rgba(76,195,138,.3)";
    case "info":
      return C.line;
  }
};

export const readinessColor = (r: number): string => (r > 0.8 ? C.green : r > 0.45 ? C.amber : C.red);

export const gradeColor = (g: string): string => (g.startsWith("A") ? C.green : g.startsWith("B") ? C.amber : C.red);

export const FONT = "'Inter','SF Pro Text',system-ui,sans-serif";
