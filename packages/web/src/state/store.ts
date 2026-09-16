// ================= client state =================
//
// Facts come from GET /api/state. Mutations reconcile only after the server
// confirms success; failed writes retain editor drafts and never fabricate local facts.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { describeAction } from "@valueflow/domain";
import type { Agent, AgentRun, AppState, Budget, CalendarEvent, GovernanceItem, ImpactPair, MetricReading, Milestone, Project, ProjectTemplate, Proposal, Release, Rule, Workspace } from "@valueflow/domain";
import type { ProjectInput, RuleInput, RunAgentInput, TemplateCreateInput } from "@valueflow/shared";
import { api } from "../api/client.ts";
import type { JobStatus } from "../api/client.ts";
import { applyLive, subscribeLive } from "./live.ts";
import type { LiveRun } from "./live.ts";
import type { Notice } from "../ui/primitives.tsx";

export interface Store {
  state: AppState | null;
  error: string | null;
  clearError: () => void;
  /** The background benchmark or scout job, while one runs. */
  job: JobStatus | null;
  /** What every run is doing right now, by run id; entries leave once the run has landed in state. */
  live: Record<string, LiveRun>;
  /** Toasts: job and run completions, applied proposals. */
  notices: Notice[];
  notify: (text: string, tone?: Notice["tone"]) => void;
  dismissNotice: (id: number) => void;
  reload: () => Promise<void>;
  /** Record an observed manual measurement. Scenario edits never call this. */
  recordReading: (pid: string, mid: string, xid: string, value: number) => Promise<MetricReading>;
  saveMilestone: (pid: string, ms: Milestone, isNew: boolean) => Promise<Milestone>;
  deleteMilestone: (pid: string, mid: string) => Promise<unknown>;
  saveTargets: (pid: string, targets: ImpactPair) => Promise<ImpactPair>;
  saveProject: (input: ProjectInput, isNew: boolean) => Promise<unknown>;
  /** Create a project and everything its template adds in one request. */
  createFromTemplate: (tid: string, input: TemplateCreateInput) => Promise<Project>;
  saveTemplates: (templates: ProjectTemplate[]) => Promise<unknown>;
  deleteProject: (pid: string) => Promise<unknown>;
  saveGovernance: (pid: string, item: GovernanceItem, isNew: boolean) => Promise<unknown>;
  deleteGovernance: (pid: string, gid: string) => Promise<unknown>;
  saveRelease: (pid: string, rel: Release, isNew: boolean) => Promise<unknown>;
  deleteRelease: (pid: string, rid: string) => Promise<unknown>;
  /** Pull fresh development facts for a project from the configured source. */
  syncProject: (pid: string) => Promise<void>;
  saveAgents: (agents: Agent[]) => Promise<unknown>;
  /** Start an agent run; a working placeholder shows until the model replies. */
  runAgent: (input: RunAgentInput) => Promise<void>;
  /** Apply or discard an agent's proposal; accepting reloads state so every derivation follows. */
  decideProposal: (id: string, decision: "accept" | "dismiss") => Promise<{ error?: string }>;
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
  saveRule: (rule: Rule | null, input: RuleInput) => Promise<unknown>;
  deleteRule: (id: string) => Promise<unknown>;
  /** The reader opened Glance: "since you last looked" starts now (applied on the next load, not this one). */
  markGlanceSeen: () => Promise<void>;
  /** Ask the curator for a fresh daily brief now. */
  curateGlance: () => Promise<void>;
  /** The project's brief: written when missing or stale (once per visit), rewritten when forced. */
  curateProject: (pid: string, force: boolean) => Promise<void>;
  saveBudgets: (budgets: Budget[]) => Promise<unknown>;
  saveCalendar: (ev: CalendarEvent, isNew: boolean) => Promise<unknown>;
  deleteCalendar: (id: string) => Promise<unknown>;
  saveWorkspace: (w: Workspace) => Promise<unknown>;
}

/** A working run the server has not named yet. */
const emptyRun = (agentId: string, proj: string | null): AgentRun => ({
  id: `pending-${Date.now()}`,
  agentId,
  proj,
  tab: "overview",
  state: "working",
  startedAt: new Date().toISOString(),
  finishedAt: null,
  instruction: null,
  summary: "Starting…",
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
});

const updateProject = (s: AppState, pid: string, fn: (p: Project) => Project): AppState => ({
  ...s,
  projects: s.projects.map((p) => (p.id === pid ? fn(p) : p)),
});

export const useStore = (): Store => {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<JobStatus | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [live, setLive] = useState<Record<string, LiveRun>>({});
  const noticeSeq = useRef(0);
  const polling = useRef(false);
  const reloadSequence = useRef(0);
  const mutationEpoch = useRef(0);

  const dismissNotice = useCallback((id: number) => setNotices((n) => n.filter((x) => x.id !== id)), []);
  const notify = useCallback(
    (text: string, tone: Notice["tone"] = "info") => {
      const id = ++noticeSeq.current;
      setNotices((n) => [...n.slice(-3), { id, text, tone }]);
      if (tone !== "bad") setTimeout(() => dismissNotice(id), 7000);
    },
    [dismissNotice],
  );

  const reload = useCallback(async () => {
    try {
      const sequence = ++reloadSequence.current;
      const epoch = mutationEpoch.current;
      const fresh = await api.state();
      if (sequence === reloadSequence.current && epoch === mutationEpoch.current) setState(fresh);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  /** Poll the job until it finishes, reloading state as batches land. */
  const awaitJob = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    let last: JobStatus | null = null;
    let finished = false;
    try {
      for (let i = 0; i < 1200; i++) {
        const st = await api.benchmarkStatus();
        last = st;
        setJob(st.running ? st : null);
        if (!st.running) {
          finished = true;
          break;
        }
        if (i % 5 === 4) void reload();
        await new Promise((r) => setTimeout(r, 3000));
      }
    } finally {
      polling.current = false;
    }
    await reload();
    if (last?.error) notify(`${last.kind === "scout" ? "Scout" : "Benchmark"} failed: ${last.error}`, "bad");
    else if (last && finished) notify(last.kind === "scout" ? `Scout finished: ${last.done} model run${last.done === 1 ? "" : "s"} benchmarked. See the Quality tab and the inbox.` : `Benchmark finished: ${last.done} of ${last.total} cases judged.`, "good");
  }, [notify, reload]);

  // The live channel: runs announce themselves, so even scheduled ones show up as they happen.
  useEffect(() => {
    let reloadTimer: ReturnType<typeof setTimeout> | null = null;
    const close = subscribeLive((m) => {
      setLive((cur) => applyLive(cur, m));
      if (m.kind === "started") {
        // A placeholder from runAgent becomes the real run as soon as the server names it.
        setState((s) => {
          if (!s) return s;
          const placeholder = s.runs.find((r) => r.id.startsWith("pending-") && r.agentId === m.run.agentId && (r.proj ?? null) === (m.run.proj ?? null));
          const known = s.runs.some((r) => r.id === m.run.id);
          if (known) return s;
          const stub: AgentRun = { ...(placeholder ?? emptyRun(m.run.agentId, m.run.proj)), ...m.run, state: "working" };
          return { ...s, runs: [stub, ...s.runs.filter((r) => r !== placeholder)] };
        });
      }
      if (m.kind === "finished" || m.kind === "changed") {
        if (reloadTimer) clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => {
          void reload().then(() => setLive((cur) => Object.fromEntries(Object.entries(cur).filter(([, r]) => r.state === "working" || r.state === "queued"))));
        }, 600);
      }
    });
    return () => {
      close();
      if (reloadTimer) clearTimeout(reloadTimer);
    };
  }, [reload]);

  useEffect(() => {
    void reload();
    // A job started before this page loaded (or by another tab) still gets a progress bar.
    api
      .benchmarkStatus()
      .then((st) => {
        if (st.running) void awaitJob();
      })
      .catch(() => undefined);
  }, [reload, awaitJob]);

  const fail = useCallback(
    (e: unknown) => {
      setError(e instanceof Error ? e.message : String(e));
      void reload();
    },
    [reload],
  );

  /** Confirm writes before updating facts; reject on failure so callers retain drafts. */
  const commit = useCallback(
    async <T,>(apply: (s: AppState) => AppState, write: () => Promise<T>, reconcile?: (s: AppState, result: T) => AppState): Promise<T> => {
      mutationEpoch.current++;
      try {
        const result = await write();
        mutationEpoch.current++;
        setState((s) => (s ? reconcile ? reconcile(s, result) : apply(s) : s));
        return result;
      } catch (e) {
        fail(e);
        throw e;
      }
    },
    [fail],
  );

  const recordReading = useCallback(
    async (pid: string, mid: string, xid: string, value: number): Promise<MetricReading> => {
      const result = await commit(
        (s) => updateProject(s, pid, (p) => ({ ...p, milestones: p.milestones.map((m) => (m.id === mid ? { ...m, metrics: m.metrics.map((x) => (x.id === xid ? { ...x, current: value } : x)) } : m)) })),
        () => api.recordReading(pid, mid, xid, { value, source: "manual" }),
        (s, response) => updateProject(s, pid, (p) => ({ ...p, milestones: p.milestones.map((m) => (m.id === mid ? { ...m, metrics: m.metrics.map((x) => (x.id === xid ? response.metric : x)) } : m)) })),
      );
      return result.reading;
    },
    [commit],
  );

  const saveMilestone = useCallback(
    (pid: string, ms: Milestone, isNew: boolean) =>
      commit(
        (s) => updateProject(s, pid, (p) => ({ ...p, milestones: isNew ? [...p.milestones, ms] : p.milestones.map((m) => (m.id === ms.id ? ms : m)) })),
        () => (isNew ? api.createMilestone(pid, ms) : api.updateMilestone(pid, ms)),
        (s, result) => updateProject(s, pid, (p) => ({ ...p, milestones: isNew ? [...p.milestones.filter((m) => m.id !== result.id), result] : p.milestones.map((m) => (m.id === result.id ? result : m)) })),
      ),
    [commit],
  );

  const deleteMilestone = useCallback(
    (pid: string, mid: string) =>
      commit(
        (s) => updateProject(s, pid, (p) => ({ ...p, historicalMilestones: [...(p.historicalMilestones ?? []), ...p.milestones.filter((m) => m.id === mid)], milestones: p.milestones.filter((m) => m.id !== mid) })),
        () => api.deleteMilestone(pid, mid),
      ),
    [commit],
  );

  const saveTargets = useCallback(
    (pid: string, targets: ImpactPair) =>
      commit(
        (s) => updateProject(s, pid, (p) => ({ ...p, targets })),
        () => api.setTargets(pid, targets),
        (s, result) => updateProject(s, pid, (p) => ({ ...p, targets: result })),
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
        (s, result) => ({ ...s, projects: isNew ? [...s.projects.filter((p) => p.id !== result.id), result] : s.projects.map((p) => (p.id === result.id ? result : p)) }),
      ),
    [commit],
  );

  const createFromTemplate = useCallback(
    (tid: string, input: TemplateCreateInput) =>
      commit(
        (s) => s,
        () => api.createFromTemplate(tid, input),
        (s, result) => ({ ...s, projects: [...s.projects.filter((p) => p.id !== result.id), result], releases: { ...s.releases, [result.id]: s.releases[result.id] ?? [] } }),
      ),
    [commit],
  );
  const saveTemplates = useCallback(
    (templates: ProjectTemplate[]) =>
      commit(
        (s) => ({ ...s, templates }),
        () => api.setTemplates(templates),
        (s, result) => ({ ...s, templates: result }),
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
        (s, result) => updateProject(s, pid, (p) => ({ ...p, governance: isNew ? [...p.governance.filter((g) => g.id !== result.id), result] : p.governance.map((g) => (g.id === result.id ? result : g)) })),
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
        (s, result) => ({ ...s, releases: { ...s.releases, [pid]: isNew ? [...(s.releases[pid] ?? []).filter((r) => r.id !== result.id), result] : (s.releases[pid] ?? []).map((r) => (r.id === result.id ? result : r)) } }),
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
        (s, result) => ({ ...s, agents: result }),
      ),
    [commit],
  );
  const runAgent = useCallback(
    async (input: RunAgentInput) => {
      const placeholder: AgentRun = { ...emptyRun(input.agentId, input.proj ?? null), id: `pending-${Date.now()}`, tab: input.tab ?? "value", instruction: input.instruction ?? null };
      setState((s) => (s ? { ...s, runs: [placeholder, ...s.runs] } : s));
      try {
        const run = await api.runAgent(input);
        setState((s) => (s ? { ...s, runs: [run, ...s.runs.filter((r) => r.id !== placeholder.id && r.id !== run.id)] } : s));
        if (run.state === "failed") setError(`${run.summary}: ${run.error ?? "unknown error"}`);
        else {
          notify(`${run.summary}`, run.state === "attention" ? "info" : "good");
          void reload();
        }
      } catch (e) {
        fail(e);
      }
    },
    [fail, notify, reload],
  );

  const decideProposal = useCallback(
    async (id: string, decision: "accept" | "dismiss") => {
      const target = state?.proposals.find((p) => p.id === id);
      try {
        const decided = decision === "accept" ? await api.acceptProposal(id) : await api.dismissProposal(id);
        setError(null);
        setState((s) => (s ? { ...s, proposals: s.proposals.map((p) => p.id === id ? decided : p) } : s));
        if (decision === "accept" && target && state) {
          notify(`Applied: ${describeAction(target.action, state, target.proj)}${target.action.type === "agent_prompt" ? " · benchmarking the new version" : ""}`, "good");
        } else if (decision === "dismiss") {
          notify("Proposal dismissed.", "good");
        }
        await reload();
        if (decision === "accept" && target?.action.type === "agent_prompt") void awaitJob();
        return {};
      } catch (e) {
        fail(e);
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
    [awaitJob, fail, notify, reload, state],
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
        throw e;
      }
    },
    [fail, reload],
  );
  const saveRule = useCallback(
    async (rule: Rule | null, input: RuleInput) => {
      if (rule) setState((s) => (s ? { ...s, rules: s.rules.map((r) => (r.id === rule.id ? { ...r, ...input } : r)) } : s));
      try {
        if (rule) {
          const updated = await api.updateRule(rule.id, input);
          setState((s) => (s ? { ...s, rules: s.rules.map((r) => (r.id === updated.id ? updated : r)) } : s));
        }
        else {
          const created = await api.createRule(input);
          setState((s) => (s ? { ...s, rules: [...s.rules, created] } : s));
        }
      } catch (e) {
        fail(e);
        throw e;
      }
    },
    [fail],
  );
  const markGlanceSeen = useCallback(async () => {
    try {
      await api.glanceSeen();
    } catch {
      /* a missed view is not worth an error toast */
    }
  }, []);
  const curateGlance = useCallback(async () => {
    try {
      const { run } = await api.curateGlance();
      if (run.state === "failed") setError(`${run.summary}: ${run.error ?? "unknown error"}`);
      else notify(`Brief rewritten: ${run.summary}`, "good");
      await reload();
    } catch (e) {
      fail(e);
    }
  }, [fail, notify, reload]);
  const curateProject = useCallback(
    async (pid: string, force: boolean) => {
      if (!force) return; // Opening a page never spends provider tokens.
      try {
        const { run } = await api.projectBrief(pid, force);
        if (!run) return;
        if (run.state === "failed") setError(`${run.summary}: ${run.error ?? "unknown error"}`);
        else if (force) notify(`Brief rewritten: ${run.summary}`, "good");
        await reload();
      } catch (e) {
        // A quiet refresh that is refused (over budget, already writing) is not worth a toast; a click is.
        if (force) fail(e);
        else console.warn("project brief", e instanceof Error ? e.message : e);
      }
    },
    [fail, notify, reload],
  );
  const saveBudgets = useCallback(
    (budgets: Budget[]) =>
      commit(
        (s) => ({ ...s, budgets }),
        () => api.setBudgets(budgets),
        (s, result) => ({ ...s, budgets: result }),
      ),
    [commit],
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
        (s, result) => ({ ...s, calendar: (isNew ? [...s.calendar.filter((c) => c.id !== result.id), result] : s.calendar.map((c) => (c.id === result.id ? result : c))).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)) }),
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
        (s, result) => ({ ...s, workspace: result }),
      ),
    [commit],
  );

  const clearError = useCallback(() => setError(null), []);

  return useMemo(
    () => ({
      state,
      error,
      clearError,
      job,
      live,
      notices,
      notify,
      dismissNotice,
      reload,
      recordReading,
      saveMilestone,
      deleteMilestone,
      saveTargets,
      saveProject,
      createFromTemplate,
      saveTemplates,
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
      markGlanceSeen,
      curateGlance,
      curateProject,
      saveBudgets,
      saveCalendar,
      deleteCalendar,
      saveWorkspace,
    }),
    [
      state,
      error,
      clearError,
      job,
      live,
      notices,
      notify,
      dismissNotice,
      reload,
      recordReading,
      saveMilestone,
      deleteMilestone,
      saveTargets,
      saveProject,
      createFromTemplate,
      saveTemplates,
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
      markGlanceSeen,
      curateGlance,
      curateProject,
      saveBudgets,
      saveCalendar,
      deleteCalendar,
      saveWorkspace,
    ],
  );
};
