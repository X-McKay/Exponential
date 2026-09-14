import { sessionHeaders } from "./session.ts";
// ================= typed API client =================

import type { Agent, AgentRun, Budget, CalendarEvent, DevFacts, DailyBrief, GovernanceItem, RunEvent, ImpactPair, Metric, MetricReading, Milestone, Project, ProjectTab, Proposal, Release, Rule, RunScore, SetupDraft, SyncRun, Workspace } from "@valueflow/domain";
import { routes } from "@valueflow/shared";
import type {
  AgentsInput,
  ApiError,
  CalendarEventInput,
  GovernanceInput,
  GovernanceItemInput,
  MilestoneInput,
  ProjectInput,
  ReadingInput,
  ReleaseInput,
  ChatInput,
  RateRunInput,
  RuleInput,
  RunAgentInput,
  ScoutInput,
  SetupCreateInput,
  TargetsInput,
  WorkspaceInput,
} from "@valueflow/shared";

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    message: string,
    public issues?: unknown,
  ) {
    super(message);
  }
}

let workspaceRevision: string | null = null;

export const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
  const form = body instanceof FormData;
  const res = await fetch(path, {
    method,
    headers: {
      ...sessionHeaders(),
      ...(method !== "GET" && workspaceRevision !== null ? { "x-valueflow-revision": workspaceRevision } : {}),
      ...(body === undefined || form ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : form ? body : JSON.stringify(body),
  });
  workspaceRevision = res.headers.get("x-valueflow-revision") ?? workspaceRevision;
  if (!res.ok) {
    let err: ApiError = { error: `${res.status} ${res.statusText}` };
    try {
      err = (await res.json()) as ApiError;
    } catch {
      // non-JSON error body
    }
    throw new ApiRequestError(res.status, err.error, err.issues);
  }
  return (await res.json()) as T;
};

type Ok = { ok: true };

export interface JobStatus {
  running: boolean;
  kind: "benchmark" | "scout" | null;
  done: number;
  total: number;
  startedAt: string | null;
  error?: string | null;
}

export const api = {
  getRun: (id: string) => request<AgentRun>("GET", routes.run(id)),
  state: () => request<import("@valueflow/domain").AppState>("GET", routes.state()),
  setWorkspace: (body: WorkspaceInput) => request<Workspace>("PUT", routes.workspace(), body),

  createProject: (body: ProjectInput) => request<Project>("POST", routes.projects(), body),
  updateProject: (body: ProjectInput) => request<Project>("PUT", routes.project(body.id), body),
  deleteProject: (pid: string) => request<Ok>("DELETE", routes.project(pid)),
  setTargets: (pid: string, body: TargetsInput) => request<ImpactPair>("PUT", routes.targets(pid), body),

  readings: (pid: string, mid: string, xid: string) => request<MetricReading[]>("GET", routes.readings(pid, mid, xid)),
  recordReading: (pid: string, mid: string, xid: string, body: ReadingInput) =>
    request<{ reading: MetricReading; metric: Metric }>("PUT", routes.readings(pid, mid, xid), body),
  createMilestone: (pid: string, body: MilestoneInput) => request<Milestone>("POST", routes.milestones(pid), body),
  updateMilestone: (pid: string, body: MilestoneInput) => request<Milestone>("PUT", routes.milestone(pid, body.id), body),
  deleteMilestone: (pid: string, mid: string) => request<Ok>("DELETE", routes.milestone(pid, mid)),

  createGovernance: (pid: string, body: GovernanceItemInput) => request<GovernanceItem>("POST", routes.governanceItems(pid), body),
  updateGovernance: (pid: string, gid: string, body: GovernanceInput) => request<GovernanceItem>("PUT", routes.governance(pid, gid), body),
  deleteGovernance: (pid: string, gid: string) => request<Ok>("DELETE", routes.governance(pid, gid)),

  createRelease: (pid: string, body: ReleaseInput) => request<Release>("POST", routes.releases(pid), body),
  updateRelease: (pid: string, body: ReleaseInput) => request<Release>("PUT", routes.release(pid, body.id), body),
  deleteRelease: (pid: string, rid: string) => request<Ok>("DELETE", routes.release(pid, rid)),

  syncProject: (pid: string) => request<{ run: SyncRun; facts: DevFacts | null }>("POST", routes.sync(pid)),
  syncStatus: () => request<{ source: string | null; projects: Record<string, SyncRun | null> }>("GET", routes.syncStatus()),
  setAgents: (body: AgentsInput) => request<Agent[]>("PUT", routes.agents(), body),
  chat: (body: ChatInput) => request<{ answer: string; links: { label: string; proj: string; tab: ProjectTab }[]; proposals: Proposal[]; runId: string; model: string }>("POST", routes.chat(), body),
  rateRun: (id: string, body: RateRunInput) => request<AgentRun>("POST", routes.runRate(id), body),
  judgeRun: (id: string) => request<RunScore[]>("POST", routes.runJudge(id)),
  runEvents: (id: string) => request<RunEvent[]>("GET", routes.runEvents(id)),
  benchmark: (agentId?: string) => request<JobStatus>("POST", routes.benchmark(), agentId ? { agentId } : {}),
  benchmarkStatus: () => request<JobStatus>("GET", routes.benchmark()),
  scout: (body: ScoutInput) => request<JobStatus>("POST", routes.scout(), body),
  setAgentPrompt: (aid: string, prompt: string | null) => request<Agent>("POST", routes.agentPrompt(aid), { prompt }),
  rules: () => request<Rule[]>("GET", routes.rules()),
  glanceSeen: () => request<Workspace>("POST", routes.glanceSeen()),
  curateGlance: () => request<{ run: AgentRun; brief: DailyBrief | null }>("POST", routes.glanceCurate()),
  /** The project's brief: rewritten when stale or forced, otherwise returned as is with run null. */
  projectBrief: (pid: string, force: boolean) => request<{ run: AgentRun | null; brief: DailyBrief | null }>("POST", `${routes.projectBrief(pid)}${force ? "?force=1" : ""}`),
  budgets: () => request<Budget[]>("GET", routes.budgets()),
  setBudgets: (body: Budget[]) => request<Budget[]>("PUT", routes.budgets(), body),
  createRule: (body: RuleInput) => request<Rule>("POST", routes.rules(), body),
  updateRule: (id: string, body: RuleInput) => request<Rule>("PUT", routes.rule(id), body),
  deleteRule: (id: string) => request<Ok>("DELETE", routes.rule(id)),
  setupAnalyze: (form: FormData) => request<SetupDraft>("POST", routes.setup(), form),
  setupRefine: (id: string, feedback: string) => request<SetupDraft>("POST", routes.setupRefine(id), { feedback }),
  setupCreate: (id: string, body: SetupCreateInput) => request<Project>("POST", routes.setupCreate(id), body),
  acceptProposal: (id: string) => request<Proposal>("POST", routes.proposalAccept(id)),
  dismissProposal: (id: string) => request<Proposal>("POST", routes.proposalDismiss(id)),
  runAgent: (input: RunAgentInput) => {
    const { agentId, ...body } = input;
    return request<AgentRun>("POST", routes.agentRuns(agentId), body);
  },
  createCalendarEvent: (body: CalendarEventInput) => request<CalendarEvent>("POST", routes.calendar(), body),
  updateCalendarEvent: (body: CalendarEventInput) => request<CalendarEvent>("PUT", routes.calendarEvent(body.id), body),
  deleteCalendarEvent: (id: string) => request<Ok>("DELETE", routes.calendarEvent(id)),
};
