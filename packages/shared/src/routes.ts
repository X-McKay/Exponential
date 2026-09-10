// ================= API routes =================
//
// One place that names every endpoint. The server matches on these patterns
// and the client builds URLs from the same helpers.

const enc = encodeURIComponent;

export const routes = {
  state: () => "/api/state",
  glance: () => "/api/glance",
  targets: (pid: string) => `/api/projects/${enc(pid)}/targets`,
  milestones: (pid: string) => `/api/projects/${enc(pid)}/milestones`,
  milestone: (pid: string, mid: string) => `/api/projects/${enc(pid)}/milestones/${enc(mid)}`,
  readings: (pid: string, mid: string, xid: string) => `/api/projects/${enc(pid)}/milestones/${enc(mid)}/metrics/${enc(xid)}/readings`,
  governance: (pid: string, gid: string) => `/api/projects/${enc(pid)}/governance/${enc(gid)}`,
} as const;

/** Route patterns (Bun.serve-style `:param` segments) in match order. */
export const patterns = {
  state: "/api/state",
  glance: "/api/glance",
  targets: "/api/projects/:pid/targets",
  milestones: "/api/projects/:pid/milestones",
  milestone: "/api/projects/:pid/milestones/:mid",
  readings: "/api/projects/:pid/milestones/:mid/metrics/:xid/readings",
  governance: "/api/projects/:pid/governance/:gid",
} as const;
