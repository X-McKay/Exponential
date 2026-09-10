// ================= API routes =================
//
// One place that names every endpoint. The server matches on these patterns
// and the client builds URLs from the same helpers.

const enc = encodeURIComponent;

export const routes = {
  state: () => "/api/state",
  glance: () => "/api/glance",
  workspace: () => "/api/workspace",
  projects: () => "/api/projects",
  project: (pid: string) => `/api/projects/${enc(pid)}`,
  targets: (pid: string) => `/api/projects/${enc(pid)}/targets`,
  milestones: (pid: string) => `/api/projects/${enc(pid)}/milestones`,
  milestone: (pid: string, mid: string) => `/api/projects/${enc(pid)}/milestones/${enc(mid)}`,
  readings: (pid: string, mid: string, xid: string) => `/api/projects/${enc(pid)}/milestones/${enc(mid)}/metrics/${enc(xid)}/readings`,
  governanceItems: (pid: string) => `/api/projects/${enc(pid)}/governance`,
  governance: (pid: string, gid: string) => `/api/projects/${enc(pid)}/governance/${enc(gid)}`,
  releases: (pid: string) => `/api/projects/${enc(pid)}/releases`,
  release: (pid: string, rid: string) => `/api/projects/${enc(pid)}/releases/${enc(rid)}`,
  sync: (pid: string) => `/api/projects/${enc(pid)}/sync`,
  syncStatus: () => "/api/sync",
  agents: () => "/api/agents",
  feed: () => "/api/feed",
  upcoming: () => "/api/upcoming",
} as const;

/** Route patterns (Bun.serve-style `:param` segments) in match order. */
export const patterns = {
  state: "/api/state",
  glance: "/api/glance",
  workspace: "/api/workspace",
  projects: "/api/projects",
  project: "/api/projects/:pid",
  targets: "/api/projects/:pid/targets",
  milestones: "/api/projects/:pid/milestones",
  milestone: "/api/projects/:pid/milestones/:mid",
  readings: "/api/projects/:pid/milestones/:mid/metrics/:xid/readings",
  governanceItems: "/api/projects/:pid/governance",
  governance: "/api/projects/:pid/governance/:gid",
  releases: "/api/projects/:pid/releases",
  release: "/api/projects/:pid/releases/:rid",
  sync: "/api/projects/:pid/sync",
  syncStatus: "/api/sync",
  agents: "/api/agents",
  feed: "/api/feed",
  upcoming: "/api/upcoming",
} as const;
