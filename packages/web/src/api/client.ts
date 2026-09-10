// ================= typed API client =================

import type { AppState, GovernanceItem, ImpactPair, Metric, MetricReading, Milestone } from "@valueflow/domain";
import { routes } from "@valueflow/shared";
import type { ApiError, GovernanceInput, MilestoneInput, ReadingInput, TargetsInput } from "@valueflow/shared";

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

export const api = {
  state: () => request<AppState>("GET", routes.state()),
  readings: (pid: string, mid: string, xid: string) => request<MetricReading[]>("GET", routes.readings(pid, mid, xid)),
  recordReading: (pid: string, mid: string, xid: string, body: ReadingInput) =>
    request<{ reading: MetricReading; metric: Metric }>("PUT", routes.readings(pid, mid, xid), body),
  createMilestone: (pid: string, body: MilestoneInput) => request<Milestone>("POST", routes.milestones(pid), body),
  updateMilestone: (pid: string, body: MilestoneInput) => request<Milestone>("PUT", routes.milestone(pid, body.id), body),
  deleteMilestone: (pid: string, mid: string) => request<{ ok: true }>("DELETE", routes.milestone(pid, mid)),
  setTargets: (pid: string, body: TargetsInput) => request<ImpactPair>("PUT", routes.targets(pid), body),
  updateGovernance: (pid: string, gid: string, body: GovernanceInput) => request<GovernanceItem>("PUT", routes.governance(pid, gid), body),
};
