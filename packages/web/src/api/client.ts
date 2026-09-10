// ================= typed API client =================

import type { Agent, DevActivity, FeedDay, GovernanceItem, ImpactPair, Metric, MetricReading, Milestone, Project, Release, Upcoming, Workspace } from "@valueflow/domain";
import { routes } from "@valueflow/shared";
import type {
  AgentsInput,
  ApiError,
  DevActivityInput,
  FeedInput,
  GovernanceInput,
  GovernanceItemInput,
  MilestoneInput,
  ProjectInput,
  ReadingInput,
  ReleaseInput,
  TargetsInput,
  UpcomingInput,
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

const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
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

export const api = {
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

  setDev: (pid: string, body: DevActivityInput) => request<DevActivity>("PUT", routes.dev(pid), body),
  setAgents: (body: AgentsInput) => request<Agent[]>("PUT", routes.agents(), body),
  setFeed: (body: FeedInput) => request<FeedDay[]>("PUT", routes.feed(), body),
  setUpcoming: (body: UpcomingInput) => request<Upcoming[]>("PUT", routes.upcoming(), body),
};
