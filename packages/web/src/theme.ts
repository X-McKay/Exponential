// ================= design tokens =================
//
// Every colour is a CSS variable so the same inline styles render in the dark
// and light themes; the values live in styles.css (`:root` and
// `[data-theme="light"]`). Status colours build on the same tokens.

import type { AgentStatus, CheckStatus, FeedType, GovStatus, MilestoneStatus, RiskTier, RunState } from "@valueflow/domain";
import type { ReleaseTone, Tone } from "@valueflow/domain";

const v = (name: string): string => `var(--vf-${name})`;

export const C = {
  bg: v("bg"),
  /** Cards and sections. */
  panel: v("panel"),
  /** Selected rows, hover fills. */
  panel2: v("panel2"),
  /** Sunken areas inside a card: run lists, code. */
  deep: v("deep"),
  /** Inputs and nested boxes. */
  inset: v("inset"),
  /** Modals, drawers, floating buttons. */
  raised: v("raised"),
  hover: v("hover"),
  /** Palette, tooltips, kbd. */
  popover: v("popover"),
  /** Default buttons, progress tracks. */
  field: v("field"),
  line: v("line"),
  line2: v("line2"),
  line3: v("line3"),
  text: v("text"),
  /** Body copy inside cards. */
  text2: v("text2"),
  mut: v("mut"),
  dim: v("dim"),
  /** Placeholders and disabled text. */
  dim2: v("dim2"),
  indigo: v("indigo"),
  indigoHi: v("indigo-hi"),
  /** Accent text on a soft accent fill. */
  indigoSoft: v("indigo-soft"),
  green: v("green"),
  greenHi: v("green-hi"),
  amber: v("amber"),
  teal: v("teal"),
  red: v("red"),
  redHi: v("red-hi"),
  backlog: v("backlog"),
  accentSoft: v("accent-soft"),
  accentSoft2: v("accent-soft2"),
  accentLine: v("accent-line"),
  accentLine2: v("accent-line2"),
  goodSoft: v("good-soft"),
  goodLine: v("good-line"),
  goodLine2: v("good-line2"),
  warnSoft: v("warn-soft"),
  warnLine: v("warn-line"),
  warnLine2: v("warn-line2"),
  badSoft: v("bad-soft"),
  badSoft2: v("bad-soft2"),
  badLine: v("bad-line"),
  badLine2: v("bad-line2"),
  shadow: v("shadow"),
  shadow2: v("shadow2"),
  overlay: v("overlay"),
  glow: v("glow"),
  chipBg: v("chip-bg"),
} as const;

export const STATUS_COLOR: Record<MilestoneStatus, string> = {
  backlog: C.backlog,
  progress: C.amber,
  eval: C.indigoHi,
  shipped: C.green,
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

export const RUN_COLOR: Record<RunState, string> = { queued: C.dim, working: C.indigoHi, done: C.green, attention: C.amber, failed: C.red };

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
      return C.badLine2;
    case "warn":
      return C.warnLine2;
    case "good":
      return C.goodLine2;
    case "info":
      return C.line;
  }
};

export const readinessColor = (r: number): string => (r > 0.8 ? C.green : r > 0.45 ? C.amber : C.red);

export const gradeColor = (g: string): string => (g.startsWith("A") ? C.green : g.startsWith("B") ? C.amber : C.red);

export const FONT = "'Google Sans Flex',system-ui,sans-serif";

// ---- theme choice ----------------------------------------------------------

export type ThemeChoice = "system" | "dark" | "light";
const THEME_KEY = "valueflow.theme";

export const readTheme = (): ThemeChoice => {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === "dark" || stored === "light" ? stored : "system";
  } catch {
    return "system";
  }
};

/** Apply a choice to the document; "system" follows prefers-color-scheme. */
export const applyTheme = (choice: ThemeChoice): void => {
  const dark = choice === "dark" || (choice === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  try {
    if (choice === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch {
    /* private mode */
  }
};

/** Whether the person asked the system for less motion; smooth scrolling and decorative animation follow it. */
export const prefersReducedMotion = (): boolean => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
