// ================= client state =================
//
// Facts come from GET /api/state. Every editor applies its change locally
// first (optimistic) and then writes through the API; on failure the store
// reloads from the server and surfaces the error.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppState, GovernanceItem, ImpactPair, Milestone, Project } from "@valueflow/domain";
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
  saveGovernance: (pid: string, item: GovernanceItem) => Promise<void>;
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
    async (pid: string, ms: Milestone, isNew: boolean) => {
      setState((s) =>
        s
          ? updateProject(s, pid, (p) => ({
              ...p,
              milestones: isNew ? [...p.milestones, ms] : p.milestones.map((m) => (m.id === ms.id ? ms : m)),
            }))
          : s,
      );
      try {
        if (isNew) await api.createMilestone(pid, ms);
        else await api.updateMilestone(pid, ms);
      } catch (e) {
        fail(e);
      }
    },
    [fail],
  );

  const deleteMilestone = useCallback(
    async (pid: string, mid: string) => {
      setState((s) => (s ? updateProject(s, pid, (p) => ({ ...p, milestones: p.milestones.filter((m) => m.id !== mid) })) : s));
      try {
        await api.deleteMilestone(pid, mid);
      } catch (e) {
        fail(e);
      }
    },
    [fail],
  );

  const saveTargets = useCallback(
    async (pid: string, targets: ImpactPair) => {
      setState((s) => (s ? updateProject(s, pid, (p) => ({ ...p, targets })) : s));
      try {
        await api.setTargets(pid, targets);
      } catch (e) {
        fail(e);
      }
    },
    [fail],
  );

  const saveGovernance = useCallback(
    async (pid: string, item: GovernanceItem) => {
      setState((s) =>
        s ? updateProject(s, pid, (p) => ({ ...p, governance: p.governance.map((g) => (g.id === item.id && g.cat === item.cat ? item : g)) })) : s,
      );
      try {
        await api.updateGovernance(pid, item.id, {
          status: item.status,
          owner: item.owner,
          date: item.date,
          detail: item.detail,
          ...(item.link ? { link: item.link } : {}),
        });
      } catch (e) {
        fail(e);
      }
    },
    [fail],
  );

  const clearError = useCallback(() => setError(null), []);

  return useMemo(
    () => ({ state, error, clearError, reload, setMetric, saveMilestone, deleteMilestone, saveTargets, saveGovernance }),
    [state, error, clearError, reload, setMetric, saveMilestone, deleteMilestone, saveTargets, saveGovernance],
  );
};
