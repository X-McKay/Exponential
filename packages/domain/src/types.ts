// ================= core domain types =================
//
// These are the *facts* the system stores. Everything about value — realized
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

export interface Milestone {
  id: string;
  name: string;
  status: MilestoneStatus;
  /** Target (or shipped) month as `YYYY-MM`; see calendar.ts. */
  month: string;
  impact: Impact;
  metrics: Metric[];
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

export type AgentKind = "deck" | "comms" | "ideation" | "audit";
export const AGENT_KINDS: readonly AgentKind[] = ["deck", "comms", "ideation", "audit"];
/** Derived from runs: working while a run is in flight, scheduled when a schedule is set, otherwise idle. */
export type AgentStatus = "working" | "idle" | "scheduled";
export type RunState = "queued" | "working" | "done" | "attention" | "failed";
export const RUN_STATES: readonly RunState[] = ["queued", "working", "done", "attention", "failed"];
export type AgentSchedule = "nightly" | null;

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
}

/** One execution of an agent against one project. */
export interface AgentRun {
  id: string;
  agentId: string;
  proj: string;
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
}

export interface LlmInfo {
  baseUrl: string;
  model: string | null;
}

// ---- proposals ------------------------------------------------------------

/** A concrete change an agent suggests; applied only when a person accepts it. */
export type ProposalAction =
  | { type: "governance_status"; gid: string; status: GovStatus }
  | { type: "milestone_status"; mid: string; status: MilestoneStatus }
  | { type: "governance_item"; cat: string; name: string; status: GovStatus; owner: string; detail: string }
  | { type: "calendar_event"; date: string; tab: ProjectTab; text: string; sub: string | null }
  | { type: "targets"; fte: number; time: number };

export type ProposalState = "pending" | "accepted" | "dismissed";

export interface Proposal {
  id: string;
  runId: string;
  agentId: string;
  proj: string;
  action: ProposalAction;
  rationale: string;
  state: ProposalState;
  createdAt: string;
  decidedAt: string | null;
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

export interface WorkspaceUser {
  name: string;
  ini: string;
}

export interface Workspace {
  user: WorkspaceUser;
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
  /** The configured model, or null when agents cannot run. */
  llm: LlmInfo | null;
  /** Pending proposals plus recently decided ones, newest first. */
  proposals: Proposal[];
  /** Newest first, trailing EVENT_WINDOW_DAYS. */
  events: Event[];
  calendar: CalendarEvent[];
}
