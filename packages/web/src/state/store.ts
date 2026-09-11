// ================= client state =================
//
// Facts come from GET /api/state. Every editor applies its change locally
// first (optimistic) and then writes through the API; on failure the store
// reloads from the server and surfaces the error.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Agent, AgentRun, AppState, CalendarEvent, GovernanceItem, ImpactPair, Milestone, Project, Proposal, Release, Rule, Workspace } from "@valueflow/domain";
import type { ProjectInput, RuleInput, RunAgentInput } from "@valueflow/shared";
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
  /** Pull fresh development facts for a project from the configured source. */
  syncProject: (pid: string) => Promise<void>;
  saveAgents: (agents: Agent[]) => Promise<void>;
  /** Start an agent run; a working placeholder shows until the model replies. */
  runAgent: (input: RunAgentInput) => Promise<void>;
  /** Apply or discard an agent's proposal; accepting reloads state so every derivation follows. */
  decideProposal: (id: string, decision: "accept" | "dismiss") => Promise<void>;
  /** Proposals that arrived outside the store (a chat turn); reloads so the run and scores show too. */
  addProposals: (proposals: Proposal[]) => void;
  rateRun: (id: string, rating: 1 | -1 | null, note?: string) => Promise<void>;
  judgeRun: (id: string) => Promise<void>;
  /** Start a benchmark; resolves when the server has finished it (polls). */
  runBenchmark: (agentId?: string) => Promise<void>;
  /** Benchmark candidate models against the current one; resolves when the scout has reported (polls). */
  runScout: (agentId?: string) => Promise<void>;
  /** Set an agent's extra instructions; records a prompt version. */
  setAgentPrompt: (agentId: string, prompt: string | null) => Promise<void>;
  saveRule: (rule: Rule | null, input: RuleInput) => Promise<void>;
  deleteRule: (id: string) => Promise<void>;
  saveCalendar: (ev: CalendarEvent, isNew: boolean) => Promise<void>;
  deleteCalendar: (id: string) => Promise<void>;
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

  const syncProject = useCallback(
    async (pid: string) => {
      try {
        const { run, facts } = await api.syncProject(pid);
        if (facts) setState((s) => (s ? { ...s, dev: { ...s.dev, [pid]: facts } } : s));
        if (!run.ok) setError(`Sync failed — ${run.message}`);
      } catch (e) {
        fail(e);
      }
    },
    [fail],
  );
  const saveAgents = useCallback(
    (agents: Agent[]) =>
      commit(
        (s) => ({ ...s, agents }),
        () => api.setAgents(agents),
      ),
    [commit],
  );
  const runAgent = useCallback(
    async (input: RunAgentInput) => {
      const placeholder: AgentRun = {
        id: `pending-${Date.now()}`,
        agentId: input.agentId,
        proj: input.proj ?? null,
        tab: input.tab ?? "value",
        state: "working",
        startedAt: new Date().toISOString(),
        finishedAt: null,
        instruction: input.instruction ?? null,
        summary: "Working…",
        output: "",
        model: null,
        error: null,
        promptVersion: null,
        latencyMs: null,
        promptTokens: null,
        completionTokens: null,
        benchmark: null,
        rating: null,
        ratingNote: null,
      };
      setState((s) => (s ? { ...s, runs: [placeholder, ...s.runs] } : s));
      try {
        const run = await api.runAgent(input);
        setState((s) => (s ? { ...s, runs: [run, ...s.runs.filter((r) => r.id !== placeholder.id && r.id !== run.id)] } : s));
        if (run.state === "failed") setError(`${run.summary}: ${run.error ?? "unknown error"}`);
      } catch (e) {
        fail(e);
      }
    },
    [fail],
  );

  const decideProposal = useCallback(
    async (id: string, decision: "accept" | "dismiss") => {
      const next = decision === "accept" ? "accepted" : "dismissed";
      setState((s) => (s ? { ...s, proposals: s.proposals.map((p) => (p.id === id ? { ...p, state: next } : p)) } : s));
      try {
        if (decision === "accept") {
          await api.acceptProposal(id);
          await reload();
        } else {
          await api.dismissProposal(id);
        }
      } catch (e) {
        fail(e);
      }
    },
    [fail, reload],
  );

  const addProposals = useCallback(
    (proposals: Proposal[]) => {
      setState((s) => (s ? { ...s, proposals: [...proposals, ...s.proposals.filter((p) => !proposals.some((n) => n.id === p.id))] } : s));
      void reload();
    },
    [reload],
  );

  const rateRun = useCallback(
    async (id: string, rating: 1 | -1 | null, note?: string) => {
      setState((s) => (s ? { ...s, runs: s.runs.map((r) => (r.id === id ? { ...r, rating, ratingNote: note ?? r.ratingNote } : r)) } : s));
      try {
        await api.rateRun(id, { rating, ...(note !== undefined ? { note } : {}) });
      } catch (e) {
        fail(e);
      }
    },
    [fail],
  );

  const judgeRun = useCallback(
    async (id: string) => {
      try {
        const scores = await api.judgeRun(id);
        setState((s) => (s ? { ...s, scores: [...s.scores.filter((x) => !(x.runId === id && x.scorer === "judge")), ...scores] } : s));
      } catch (e) {
        fail(e);
      }
    },
    [fail],
  );

  const awaitJob = useCallback(async () => {
    for (let i = 0; i < 1200; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const st = await api.benchmarkStatus();
      if (!st.running) break;
      if (i % 5 === 4) void reload();
    }
    await reload();
  }, [reload]);
  const runBenchmark = useCallback(
    async (agentId?: string) => {
      try {
        await api.benchmark(agentId);
        await awaitJob();
      } catch (e) {
        fail(e);
      }
    },
    [awaitJob, fail],
  );
  const runScout = useCallback(
    async (agentId?: string) => {
      try {
        await api.scout(agentId ? { agentId } : {});
        await awaitJob();
      } catch (e) {
        fail(e);
      }
    },
    [awaitJob, fail],
  );
  const setAgentPrompt = useCallback(
    async (agentId: string, prompt: string | null) => {
      setState((s) => (s ? { ...s, agents: s.agents.map((a) => (a.id === agentId ? { ...a, prompt } : a)) } : s));
      try {
        await api.setAgentPrompt(agentId, prompt);
        await reload();
      } catch (e) {
        fail(e);
      }
    },
    [fail, reload],
  );
  const saveRule = useCallback(
    async (rule: Rule | null, input: RuleInput) => {
      if (rule) setState((s) => (s ? { ...s, rules: s.rules.map((r) => (r.id === rule.id ? { ...r, ...input } : r)) } : s));
      try {
        if (rule) await api.updateRule(rule.id, input);
        else {
          const created = await api.createRule(input);
          setState((s) => (s ? { ...s, rules: [...s.rules, created] } : s));
        }
      } catch (e) {
        fail(e);
      }
    },
    [fail],
  );
  const deleteRule = useCallback(
    (id: string) =>
      commit(
        (s) => ({ ...s, rules: s.rules.filter((r) => r.id !== id) }),
        () => api.deleteRule(id),
      ),
    [commit],
  );

  const saveCalendar = useCallback(
    (ev: CalendarEvent, isNew: boolean) =>
      commit(
        (s) => ({ ...s, calendar: (isNew ? [...s.calendar, ev] : s.calendar.map((c) => (c.id === ev.id ? ev : c))).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)) }),
        () => (isNew ? api.createCalendarEvent(ev) : api.updateCalendarEvent(ev)),
      ),
    [commit],
  );
  const deleteCalendar = useCallback(
    (id: string) =>
      commit(
        (s) => ({ ...s, calendar: s.calendar.filter((c) => c.id !== id) }),
        () => api.deleteCalendarEvent(id),
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
      syncProject,
      saveAgents,
      runAgent,
      decideProposal,
      addProposals,
      rateRun,
      judgeRun,
      runBenchmark,
      runScout,
      setAgentPrompt,
      saveRule,
      deleteRule,
      saveCalendar,
      deleteCalendar,
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
      syncProject,
      saveAgents,
      runAgent,
      decideProposal,
      addProposals,
      rateRun,
      judgeRun,
      runBenchmark,
      runScout,
      setAgentPrompt,
      saveRule,
      deleteRule,
      saveCalendar,
      deleteCalendar,
      saveWorkspace,
    ],
  );
};
