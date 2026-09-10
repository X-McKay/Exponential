// ================= client state =================
//
// Facts come from GET /api/state. Every editor applies its change locally
// first (optimistic) and then writes through the API; on failure the store
// reloads from the server and surfaces the error.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Agent, AppState, DevActivity, FeedDay, GovernanceItem, ImpactPair, Milestone, Project, Release, Upcoming, Workspace } from "@valueflow/domain";
import type { ProjectInput } from "@valueflow/shared";
import { api } from "../api/client.ts";

export interface Store {
  state: AppState | null;
  error: string | null;
  clearError: () => void;
  reload: () => Promise<void>;
  setMetric: (pid: string, mid: string, xid: string, value: number) => void;
  saveMilestone: (pid: string, ms: Milestone, isNew: boolean) => Promise<void>;
  deleteMilestone: (pid: string, mid: string) => Promise<void>;
  saveTargets: (pid: string, targets: ImpactPair) => Promise<void>;
  saveProject: (input: ProjectInput, isNew: boolean) => Promise<void>;
  deleteProject: (pid: string) => Promise<void>;
  saveGovernance: (pid: string, item: GovernanceItem, isNew: boolean) => Promise<void>;
  deleteGovernance: (pid: string, gid: string) => Promise<void>;
  saveRelease: (pid: string, rel: Release, isNew: boolean) => Promise<void>;
  deleteRelease: (pid: string, rid: string) => Promise<void>;
  saveDev: (pid: string, doc: DevActivity) => Promise<void>;
  saveAgents: (agents: Agent[]) => Promise<void>;
  saveFeed: (feed: FeedDay[]) => Promise<void>;
  saveUpcoming: (items: Upcoming[]) => Promise<void>;
  saveWorkspace: (w: Workspace) => Promise<void>;
}

const updateProject = (s: AppState, pid: string, fn: (p: Project) => Project): AppState => ({
  ...s,
  projects: s.projects.map((p) => (p.id === pid ? fn(p) : p)),
});

const METRIC_DEBOUNCE_MS = 180;

export const useStore = (): Store => {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const reload = useCallback(async () => {
    try {
      setState(await api.state());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const fail = useCallback(
    (e: unknown) => {
      setError(e instanceof Error ? e.message : String(e));
      void reload();
    },
    [reload],
  );

  /** Apply an optimistic update, then run the write; reload on failure. */
  const commit = useCallback(
    async (apply: (s: AppState) => AppState, write: () => Promise<unknown>) => {
      setState((s) => (s ? apply(s) : s));
      try {
        await write();
      } catch (e) {
        fail(e);
      }
    },
    [fail],
  );

  const setMetric = useCallback(
    (pid: string, mid: string, xid: string, value: number) => {
      setState((s) =>
        s
          ? updateProject(s, pid, (p) => ({
              ...p,
              milestones: p.milestones.map((m) =>
                m.id !== mid ? m : { ...m, metrics: m.metrics.map((x) => (x.id === xid ? { ...x, current: value } : x)) },
              ),
            }))
          : s,
      );
      // Slider drags fire many events; persist the latest value per metric.
      const key = `${pid}/${mid}/${xid}`;
      const prev = pending.current.get(key);
      if (prev) clearTimeout(prev);
      pending.current.set(
        key,
        setTimeout(() => {
          pending.current.delete(key);
          api.recordReading(pid, mid, xid, { value, source: "manual" }).catch(fail);
        }, METRIC_DEBOUNCE_MS),
      );
    },
    [fail],
  );

  const saveMilestone = useCallback(
    (pid: string, ms: Milestone, isNew: boolean) =>
      commit(
        (s) => updateProject(s, pid, (p) => ({ ...p, milestones: isNew ? [...p.milestones, ms] : p.milestones.map((m) => (m.id === ms.id ? ms : m)) })),
        () => (isNew ? api.createMilestone(pid, ms) : api.updateMilestone(pid, ms)),
      ),
    [commit],
  );

  const deleteMilestone = useCallback(
    (pid: string, mid: string) =>
      commit(
        (s) => updateProject(s, pid, (p) => ({ ...p, milestones: p.milestones.filter((m) => m.id !== mid) })),
        () => api.deleteMilestone(pid, mid),
      ),
    [commit],
  );

  const saveTargets = useCallback(
    (pid: string, targets: ImpactPair) =>
      commit(
        (s) => updateProject(s, pid, (p) => ({ ...p, targets })),
        () => api.setTargets(pid, targets),
      ),
    [commit],
  );

  const saveProject = useCallback(
    (input: ProjectInput, isNew: boolean) =>
      commit(
        (s) =>
          isNew
            ? { ...s, projects: [...s.projects, { ...input, milestones: [], governance: [] }], releases: { ...s.releases, [input.id]: [] } }
            : updateProject(s, input.id, (p) => ({ ...p, ...input })),
        () => (isNew ? api.createProject(input) : api.updateProject(input)),
      ),
    [commit],
  );

  const deleteProject = useCallback(
    (pid: string) =>
      commit(
        (s) => {
          const { [pid]: _r, ...releases } = s.releases;
          const { [pid]: _d, ...dev } = s.dev;
          void _r;
          void _d;
          return { ...s, projects: s.projects.filter((p) => p.id !== pid), releases, dev };
        },
        () => api.deleteProject(pid),
      ),
    [commit],
  );

  const saveGovernance = useCallback(
    (pid: string, item: GovernanceItem, isNew: boolean) =>
      commit(
        (s) => updateProject(s, pid, (p) => ({ ...p, governance: isNew ? [...p.governance, item] : p.governance.map((g) => (g.id === item.id ? item : g)) })),
        () => {
          const body = { cat: item.cat, name: item.name, status: item.status, owner: item.owner, date: item.date, detail: item.detail, ...(item.link ? { link: item.link } : {}) };
          return isNew ? api.createGovernance(pid, { id: item.id, ...body }) : api.updateGovernance(pid, item.id, body);
        },
      ),
    [commit],
  );

  const deleteGovernance = useCallback(
    (pid: string, gid: string) =>
      commit(
        (s) => updateProject(s, pid, (p) => ({ ...p, governance: p.governance.filter((g) => g.id !== gid) })),
        () => api.deleteGovernance(pid, gid),
      ),
    [commit],
  );

  const saveRelease = useCallback(
    (pid: string, rel: Release, isNew: boolean) =>
      commit(
        (s) => {
          const list = s.releases[pid] ?? [];
          return { ...s, releases: { ...s.releases, [pid]: isNew ? [...list, rel] : list.map((r) => (r.id === rel.id ? rel : r)) } };
        },
        () => (isNew ? api.createRelease(pid, rel) : api.updateRelease(pid, rel)),
      ),
    [commit],
  );

  const deleteRelease = useCallback(
    (pid: string, rid: string) =>
      commit(
        (s) => ({ ...s, releases: { ...s.releases, [pid]: (s.releases[pid] ?? []).filter((r) => r.id !== rid) } }),
        () => api.deleteRelease(pid, rid),
      ),
    [commit],
  );

  const saveDev = useCallback(
    (pid: string, doc: DevActivity) =>
      commit(
        (s) => ({ ...s, dev: { ...s.dev, [pid]: doc } }),
        () => api.setDev(pid, doc),
      ),
    [commit],
  );
  const saveAgents = useCallback(
    (agents: Agent[]) =>
      commit(
        (s) => ({ ...s, agents }),
        () => api.setAgents(agents),
      ),
    [commit],
  );
  const saveFeed = useCallback(
    (feed: FeedDay[]) =>
      commit(
        (s) => ({ ...s, feed }),
        () => api.setFeed(feed),
      ),
    [commit],
  );
  const saveUpcoming = useCallback(
    (upcoming: Upcoming[]) =>
      commit(
        (s) => ({ ...s, upcoming }),
        () => api.setUpcoming(upcoming),
      ),
    [commit],
  );
  const saveWorkspace = useCallback(
    (workspace: Workspace) =>
      commit(
        (s) => ({ ...s, workspace }),
        () => api.setWorkspace(workspace),
      ),
    [commit],
  );

  const clearError = useCallback(() => setError(null), []);

  return useMemo(
    () => ({
      state,
      error,
      clearError,
      reload,
      setMetric,
      saveMilestone,
      deleteMilestone,
      saveTargets,
      saveProject,
      deleteProject,
      saveGovernance,
      deleteGovernance,
      saveRelease,
      deleteRelease,
      saveDev,
      saveAgents,
      saveFeed,
      saveUpcoming,
      saveWorkspace,
    }),
    [
      state,
      error,
      clearError,
      reload,
      setMetric,
      saveMilestone,
      deleteMilestone,
      saveTargets,
      saveProject,
      deleteProject,
      saveGovernance,
      deleteGovernance,
      saveRelease,
      deleteRelease,
      saveDev,
      saveAgents,
      saveFeed,
      saveUpcoming,
      saveWorkspace,
    ],
  );
};
