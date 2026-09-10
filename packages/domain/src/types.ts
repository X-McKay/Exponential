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

// ---- development activity ----------------------------------------------

export type CheckStatus = "pass" | "fail" | "running";
export type PrStatus = "open" | "merged";
export type BuildStatus = "pass" | "fail";

export interface DevStats {
  coverage: number;
  quality: string;
  buildPass: number;
  mergedPRs: number;
  medianReview: string;
  deploys: number;
}

export interface DevRepo {
  name: string;
  branch: string;
  coverage: number;
  quality: string;
  lang: string;
}

export interface PullRequest {
  id: string;
  title: string;
  repo: string;
  author: string;
  status: PrStatus;
  checks: CheckStatus;
  add: number;
  del: number;
  age: string;
  reviewers: string[];
}

export interface Build {
  id: string;
  repo: string;
  branch: string;
  status: BuildStatus;
  note: string;
  when: string;
  dur: string;
}

export interface Contributor {
  ini: string;
  name: string;
  commits: number;
  reviews: number;
}

export interface DevActivity {
  stats: DevStats;
  repos: DevRepo[];
  activitySeed: number;
  activityLevel: number;
  prs: PullRequest[];
  builds: Build[];
  people: Contributor[];
}

// ---- agents -------------------------------------------------------------

export type AgentStatus = "working" | "idle" | "scheduled";
export type SessionState = "done" | "working" | "attention";

export interface AgentSession {
  when: string;
  state: SessionState;
  text: string;
  proj: string;
  tab: ProjectTab;
}

export interface Agent {
  id: string;
  name: string;
  grad: string;
  purpose: string;
  status: AgentStatus;
  model: string;
  runs: number;
  success: number;
  last: string;
  owner: string;
  caps: string[];
  sessions: AgentSession[];
}

// ---- feed & calendar ----------------------------------------------------

export type FeedType = "build" | "eval" | "merge" | "deploy" | "gov" | "ship";
export const FEED_TYPES: readonly FeedType[] = ["build", "eval", "merge", "deploy", "gov", "ship"];

export type ProjectTab = "overview" | "value" | "roadmap" | "development" | "governance";
export const PROJECT_TABS: readonly ProjectTab[] = ["overview", "value", "roadmap", "development", "governance"];

export interface FeedItem {
  t: string;
  type: FeedType;
  proj: string;
  tab: ProjectTab;
  text: string;
}

export interface FeedDay {
  day: string;
  items: FeedItem[];
}

export interface Upcoming {
  date: string;
  proj: string;
  tab: ProjectTab;
  text: string;
  sub: string | null;
  release?: { pid: string; rid: string };
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
  workspace: Workspace;
  projects: Project[];
  releases: Record<string, Release[]>;
  dev: Record<string, DevActivity>;
  agents: Agent[];
  feed: FeedDay[];
  upcoming: Upcoming[];
}
