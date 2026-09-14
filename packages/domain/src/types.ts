// ================= core domain types =================
//
// These are the *facts* the system stores. Everything about value — eligible
// impact, gate tiers, readiness, release states, the Glance briefing — is
// derived from these at read time and never persisted (see derive.ts).

export type MilestoneStatus = "backlog" | "progress" | "eval" | "shipped";
export const MILESTONE_STATUSES: readonly MilestoneStatus[] = ["backlog", "progress", "eval", "shipped"];

export type GovStatus = "approved" | "in_review" | "draft" | "missing" | "na";
export const GOV_STATUSES: readonly GovStatus[] = ["approved", "in_review", "draft", "missing", "na"];

export type RiskTier = 1 | 2 | 3;

/** The two value dimensions every impact/target is expressed in. */
export type Dim = "fte" | "time";
export const DIMS: readonly Dim[] = ["fte", "time"];

/** Gate tier a milestone has cleared: 0 = below base / unmeasured, 1 = base, 2 = stretch. */
export type GateTier = 0 | 1 | 2;

export interface ImpactPair {
  fte: number;
  time: number;
}

export interface Impact {
  base: ImpactPair;
  stretch: ImpactPair;
}

export interface Metric {
  /** Unique within its milestone. */
  id: string;
  label: string;
  base: number;
  stretch: number;
  /** Latest recorded reading (derived from metric_readings server-side; 0 when none). */
  current: number;
  /** When and how the latest reading was recorded, when the server knows. */
  readAt?: string | null;
  readSource?: "eval" | "manual" | null;
}

export interface MetricReading {
  projectId: string;
  milestoneId: string;
  metricId: string;
  value: number;
  /** ISO-8601 timestamp. */
  recordedAt: string;
  source: "eval" | "manual";
}

/** Immutable definition/status fact captured whenever a milestone changes. */
export interface MilestoneSnapshot {
  /** Database sequence for deterministic ordering when timestamps tie. */
  seq?: number;
  at: string;
  status: MilestoneStatus;
  month: string;
  impact: Impact;
  metrics: Metric[];
}

export interface Milestone {
  id: string;
  name: string;
  /** Creation instant when known; legacy rows may omit it. */
  createdAt?: string | null;
  status: MilestoneStatus;
  /** Target (or shipped) month as `YYYY-MM`; see calendar.ts. */
  month: string;
  impact: Impact;
  metrics: Metric[];
  /** Historical definitions captured by the server; absent for in-memory fixtures. */
  snapshots?: MilestoneSnapshot[];
}

export interface GovernanceItem {
  cat: string;
  id: string;
  name: string;
  status: GovStatus;
  owner: string;
  date: string | null;
  detail: string;
  link?: string;
}

export interface Repo {
  name: string;
  url: string;
}

export interface TeamMember {
  ini: string;
  name: string;
  role: string;
}

export interface Committee {
  date: string;
  ref: string;
}

export interface Project {
  id: string;
  key: string;
  name: string;
  stage: string;
  description: string;
  tier: RiskTier | null;
  committee: Committee | null;
  repos: Repo[];
  team: TeamMember[];
  targets: ImpactPair;
  milestones: Milestone[];
  /** Retired milestone facts kept for historical derivations only. */
  historicalMilestones?: Milestone[];
  governance: GovernanceItem[];
}

// ---- releases -----------------------------------------------------------

export type Criterion =
  | { type: "gate"; ms: string; label: string }
  | { type: "gov"; gid: string; label: string }
  | { type: "manual"; ok: boolean; label: string };

export interface Release {
  id: string;
  name: string;
  /** Target month as `YYYY-MM`. */
  month: string;
  milestoneIds: string[];
  criteria: Criterion[];
}

// ---- development activity (facts synced from source control and CI) ----

export type CheckStatus = "pass" | "fail" | "running";
export const CHECK_STATUSES: readonly CheckStatus[] = ["pass", "fail", "running"];
export type PrStatus = "open" | "merged" | "closed";
export const PR_STATUSES: readonly PrStatus[] = ["open", "merged", "closed"];
export type BuildStatus = "pass" | "fail" | "running";
export const BUILD_STATUSES: readonly BuildStatus[] = ["pass", "fail", "running"];
export type BuildKind = "ci" | "deploy" | "eval";
export const BUILD_KINDS: readonly BuildKind[] = ["ci", "deploy", "eval"];

/** Latest known state of one repository. */
export interface RepoStat {
  repo: string;
  branch: string;
  lang: string | null;
  /** Test coverage %, when a source reports it. */
  coverage: number | null;
  /** Static-analysis grade, when a source reports it. */
  quality: string | null;
  /** ISO timestamp the numbers were taken. */
  measuredAt: string;
}

export interface PullRequest {
  repo: string;
  number: number;
  title: string;
  /** Author initials (matched to the team where possible). */
  author: string;
  status: PrStatus;
  checks: CheckStatus;
  add: number;
  del: number;
  openedAt: string;
  mergedAt: string | null;
  updatedAt: string;
  reviewers: string[];
  url: string | null;
}

export interface Build {
  repo: string;
  /** Source-specific id ("#1148", a workflow run id). */
  id: string;
  branch: string;
  kind: BuildKind;
  status: BuildStatus;
  note: string;
  startedAt: string;
  durationS: number;
  url: string | null;
}

/** Commits by one author in one repo on one day. */
export interface CommitDay {
  repo: string;
  /** YYYY-MM-DD */
  day: string;
  author: string;
  count: number;
}

export interface SyncRun {
  source: string;
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  message: string;
}

/** Everything synced for one project. Stats, charts, and rankings derive from these (see dev.ts). */
export interface DevFacts {
  repos: RepoStat[];
  prs: PullRequest[];
  builds: Build[];
  commits: CommitDay[];
  lastSync: SyncRun | null;
}

// ---- agents -------------------------------------------------------------

export type AgentKind = "deck" | "comms" | "ideation" | "audit" | "chat" | "rules" | "brief" | "tuner" | "scout" | "curator";
export const AGENT_KINDS: readonly AgentKind[] = ["deck", "comms", "ideation", "audit", "chat", "rules", "brief", "tuner", "scout", "curator"];
/** Kinds briefed with one project at a time; the rest work over the whole workspace. */
export const PROJECT_KINDS: readonly AgentKind[] = ["deck", "comms", "ideation", "audit", "chat", "rules"];
/** Derived from runs: working while a run is in flight, scheduled when a schedule is set, otherwise idle. */
export type AgentStatus = "working" | "idle" | "scheduled";
export type RunState = "queued" | "working" | "done" | "attention" | "failed";
export const RUN_STATES: readonly RunState[] = ["queued", "working", "done", "attention", "failed"];
export type AgentSchedule = "nightly" | "weekly" | null;

/** What an agent is; everything about how it has been doing derives from its runs. */
export interface Agent {
  id: string;
  name: string;
  grad: string;
  purpose: string;
  kind: AgentKind;
  /** Model override; null uses the workspace default. */
  model: string | null;
  owner: string;
  caps: string[];
  schedule: AgentSchedule;
  /** Extra instructions layered on the kind's built-in role; null means the built-in prompt alone. */
  prompt: string | null;
}

/** A prompt a person or the tuner set for an agent; the version is the hash runs carry. */
export interface PromptVersion {
  agentId: string;
  version: string;
  prompt: string | null;
  at: string;
  source: "person" | "tuner";
}

/** A standing rule in plain language; the rules agent checks it nightly and proposes what follows. */
export interface Rule {
  id: string;
  text: string;
  /** Project the rule is scoped to, or null for every project. */
  proj: string | null;
  enabled: boolean;
  /** Apply this rule's proposals immediately instead of waiting for a decision. Earned, never default. */
  auto: boolean;
  owner: string;
  createdAt: string;
}

/** One execution of an agent against one project, or the whole workspace when proj is null. */
export interface AgentRun {
  id: string;
  agentId: string;
  proj: string | null;
  tab: ProjectTab;
  state: RunState;
  startedAt: string;
  finishedAt: string | null;
  instruction: string | null;
  /** One line describing the output; shown in lists. */
  summary: string;
  /** Full output (markdown). */
  output: string;
  model: string | null;
  error: string | null;
  /** Short hash of the prompt the run used, so quality can be compared across prompt changes. */
  promptVersion: string | null;
  latencyMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  /** Benchmark case id when the run was part of a benchmark, else null. */
  benchmark: string | null;
  /** Human rating: 1 useful, -1 not useful. */
  rating: 1 | -1 | null;
  ratingNote: string | null;
}

/** What a run is doing, in order; each step is recorded as a fact and streamed live. */
export type RunStep = "briefing" | "request" | "reply" | "retry" | "parsed" | "proposals" | "applied" | "scored" | "delivered" | "judge" | "judged" | "done" | "failed";
export const RUN_STEPS: readonly RunStep[] = ["briefing", "request", "reply", "retry", "parsed", "proposals", "applied", "scored", "delivered", "judge", "judged", "done", "failed"];

/** One line in a run's log: when it happened, which step, and a short detail. */
export interface RunEvent {
  runId: string;
  seq: number;
  at: string;
  step: RunStep;
  detail: string;
}

/** One measured dimension of one run: deterministic rules or the LLM judge. */
export interface RunScore {
  runId: string;
  scorer: "rules" | "judge";
  dimension: string;
  /** 0–1 */
  score: number;
  note: string;
  at: string;
}

/** A fixed question an agent is expected to answer well; benchmarks re-run these to compare prompts and models. */
export interface EvalCase {
  id: string;
  agentId: string;
  proj: string;
  instruction: string;
  /** Things a good answer must contain; the judge scores each. */
  expectations: string[];
}

export interface LlmInfo {
  baseUrl: string;
  model: string | null;
  /** Every model runs may use: the default plus candidates (LLM_MODELS), for the scout to compare. */
  models: string[];
  /** Model the judge uses when it differs from the default. */
  judgeModel: string | null;
  /** USD per million tokens by model (LLM_PRICES); spend is derived from runs' token counts. */
  prices: Record<string, ModelPrice>;
}

/** What a model costs, in USD per million tokens in and out. */
export interface ModelPrice {
  input: number;
  output: number;
}

/** A monthly ceiling on agent spend for the workspace, one agent, or one project; enforced, never averaged. */
export type BudgetScope = "workspace" | "agent" | "project";
export const BUDGET_SCOPES: readonly BudgetScope[] = ["workspace", "agent", "project"];
export interface Budget {
  scope: BudgetScope;
  /** Agent or project id; "" for the workspace. */
  ref: string;
  monthlyTokens: number | null;
  monthlyUsd: number | null;
}

// ---- project setup drafts ---------------------------------------------------

export type Confidence = "high" | "medium" | "low";

/** A value the setup agent suggested, with where it came from and how sure it is. */
export interface Suggested<T> {
  value: T;
  rationale: string;
  source: string | null;
  confidence: Confidence;
}

export interface DraftMilestone {
  name: string;
  status: MilestoneStatus;
  month: string;
  impact: Impact;
  metrics: { label: string; base: number; stretch: number }[];
}

export interface DraftGovernance {
  cat: string;
  name: string;
  status: GovStatus;
  /** Person's name as written in the documents; mapped to initials on create. */
  owner: string;
  detail: string;
}

export interface DraftRelease {
  name: string;
  month: string;
  /** Milestone names shipped in this release. */
  milestones: string[];
  criteria: { type: "gate" | "gov" | "manual"; ref: string; label: string }[];
}

/** The whole project record as suggested from documents. */
export interface ProjectDraft {
  description: Suggested<string>;
  stage: Suggested<string>;
  tier: Suggested<RiskTier | null>;
  committee: Suggested<Committee | null>;
  targets: Suggested<ImpactPair>;
  team: Suggested<TeamMember>[];
  repos: Suggested<Repo>[];
  milestones: Suggested<DraftMilestone>[];
  governance: Suggested<DraftGovernance>[];
  releases: Suggested<DraftRelease>[];
  notes: string[];
}

export interface SetupSource {
  name: string;
  kind: "docx" | "pptx" | "text" | "unsupported";
  chars: number;
  error: string | null;
}

export interface SetupDraft {
  id: string;
  createdAt: string;
  name: string;
  key: string;
  brief: string;
  sources: SetupSource[];
  draft: ProjectDraft;
  feedback: string[];
  model: string | null;
}

// ---- proposals ------------------------------------------------------------

/** A concrete change an agent suggests; applied only when a person accepts it. */
export type ProposalAction =
  | { type: "governance_status"; gid: string; status: GovStatus }
  | { type: "milestone_status"; mid: string; status: MilestoneStatus }
  | { type: "governance_item"; cat: string; name: string; status: GovStatus; owner: string; detail: string }
  | { type: "calendar_event"; date: string; tab: ProjectTab; text: string; sub: string | null }
  | { type: "targets"; fte: number; time: number }
  | { type: "agent_prompt"; agentId: string; prompt: string | null }
  | { type: "agent_model"; agentId: string; model: string | null };

export type ProposalState = "pending" | "accepted" | "dismissed";

export interface Proposal {
  id: string;
  runId: string;
  agentId: string;
  /** Project the change applies to; null for workspace-level changes (an agent's prompt or model). */
  proj: string | null;
  /** The standing rule that produced it, when a rule did. */
  ruleId: string | null;
  action: ProposalAction;
  rationale: string;
  state: ProposalState;
  createdAt: string;
  decidedAt: string | null;
  /** Actor and mode for an accepted/dismissed decision, when recorded. */
  decidedBy?: string | null;
  decisionMode?: "human" | "automatic" | null;
}

// ---- feed & calendar ----------------------------------------------------

export type FeedType = "build" | "eval" | "merge" | "deploy" | "gov" | "ship";
export const FEED_TYPES: readonly FeedType[] = ["build", "eval", "merge", "deploy", "gov", "ship"];

export type ProjectTab = "overview" | "value" | "roadmap" | "development" | "governance";
export const PROJECT_TABS: readonly ProjectTab[] = ["overview", "value", "roadmap", "development", "governance"];

/** Append-only activity log entry; the feed and Glance "Recent activity" derive from these. */
export interface Event {
  /** Stable identity so syncs never duplicate an entry ("pr:repo#409:merged"). */
  ref: string;
  at: string;
  type: FeedType;
  proj: string;
  tab: ProjectTab;
  text: string;
}

/** A dated, user-entered item; release targets join it at read time to form "Coming up". */
export interface CalendarEvent {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  proj: string;
  tab: ProjectTab;
  text: string;
  sub: string | null;
}

// ---- workspace ----------------------------------------------------------

export type WorkspaceRole = "admin" | "editor" | "viewer";
export interface WorkspaceMember { id: string; name: string; ini: string; role: WorkspaceRole }

export interface WorkspaceUser {
  name: string;
  ini: string;
}

export interface Workspace {
  user: WorkspaceUser;
  /** When the signed-in user last opened Glance; "since you last looked" starts here. */
  lastGlanceAt: string | null;
}

/**
 * A widget the daily brief may embed. Every widget points at facts by id and
 * is rendered from live state, so a brief written this morning shows this
 * afternoon's numbers. The table is the one free-form shape; its cells are
 * checked against the briefing like any other cited figure.
 */
export type Widget =
  | { type: "metric"; proj: string; mid: string; xid: string }
  | { type: "gates"; proj: string; mid: string }
  | { type: "release"; proj: string; rid: string }
  | { type: "governance"; proj: string }
  | { type: "value"; proj: string; dim: Dim }
  | { type: "proposals"; ids: string[] }
  | { type: "ci"; proj: string; repo: string; number: number }
  | { type: "upcoming"; days: number }
  | { type: "activity"; hours: number }
  | { type: "table"; columns: string[]; rows: string[][] };

export type WidgetType = Widget["type"];
export const WIDGET_TYPES: readonly WidgetType[] = ["metric", "gates", "release", "governance", "value", "proposals", "ci", "upcoming", "activity", "table"];

/** "Top of mind" needs the reader today; "FYI" is worth knowing. */
export type BriefGroup = "top" | "fyi";
export const BRIEF_GROUPS: readonly BriefGroup[] = ["top", "fyi"];

/** Where an item leads: a project tab, or "inbox" for proposals. */
export interface BriefAction {
  label: string;
  proj: string;
  tab: ProjectTab;
}

/** One item of the brief: a short snippet, where to go, what to do, and at most one widget. */
export interface BriefSection {
  group: BriefGroup;
  text: string;
  /** One muted sentence on what to do about it, or null. */
  tip: string | null;
  action: BriefAction | null;
  widget: Widget | null;
}

/**
 * The daily brief for one reader: prose that says what they need to know,
 * with widgets where a visual earns its place. A run's output, stored as
 * pointers and text; never a copy of derived state.
 */
export interface DailyBrief {
  runId: string;
  at: string;
  /** Hash of the composer's signals the brief was written from; a different hash means facts moved. */
  stateHash: string;
  headline: string;
  sections: BriefSection[];
  model: string | null;
}

// ---- aggregate ----------------------------------------------------------

/** Everything the client needs to render every page. All facts, no derived values. */
export interface AppState {
  /** ISO timestamp of the server clock when the state was read; "today" for every derivation. */
  asOf: string;
  /** Name of the configured development-facts source, or null when syncing is off. */
  syncSource: string | null;
  workspace: Workspace;
  projects: Project[];
  releases: Record<string, Release[]>;
  dev: Record<string, DevFacts>;
  agents: Agent[];
  /** Newest first, trailing RUN_WINDOW_DAYS. */
  runs: AgentRun[];
  /** Usage-ledger view of this month's attempts, when a ledger has records. */
  usageRuns?: AgentRun[];
  /** The configured model, or null when agents cannot run. */
  llm: LlmInfo | null;
  /** Pending proposals plus recently decided ones, newest first. */
  proposals: Proposal[];
  /** Scores for the runs in `runs`. */
  scores: RunScore[];
  rules: Rule[];
  /** Prompt changes people and the tuner made, newest first. */
  promptVersions: PromptVersion[];
  /** The latest daily brief for the signed-in user, or null for the composer's own. */
  brief: DailyBrief | null;
  /** The latest project brief per project id, for the project overview. */
  projectBriefs: Record<string, DailyBrief>;
  /** Monthly spend ceilings; runs are refused once one is reached. */
  budgets: Budget[];
  /** Newest first, trailing EVENT_WINDOW_DAYS. */
  events: Event[];
  calendar: CalendarEvent[];
}
