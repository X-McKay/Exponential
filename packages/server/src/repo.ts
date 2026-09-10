// ================= data access =================
//
// Reads assemble facts into domain objects. Writes persist facts. No derived
// value is read or written here.

import type { Database } from "bun:sqlite";
import type {
  Agent,
  AppState,
  Build,
  Criterion,
  DevFacts,
  FeedDay,
  GovernanceItem,
  Metric,
  MetricReading,
  Milestone,
  MilestoneStatus,
  Project,
  PullRequest,
  Release,
  RiskTier,
  SyncRun,
  Upcoming,
  Workspace,
} from "@valueflow/domain";
import type {
  AgentsInput,
  FeedInput,
  GovernanceInput,
  GovernanceItemInput,
  MilestoneInput,
  ProjectInput,
  ReleaseInput,
  TargetsInput,
  UpcomingInput,
  WorkspaceInput,
} from "@valueflow/shared";

export class NotFound extends Error {
  override name = "NotFound";
}
export class Conflict extends Error {
  override name = "Conflict";
}

interface ProjectRow {
  id: string;
  key: string;
  name: string;
  stage: string;
  description: string;
  tier: number | null;
  committee_date: string | null;
  committee_ref: string | null;
  target_fte: number;
  target_time: number;
}
interface RepoRow {
  project_id: string;
  name: string;
  url: string;
}
interface MemberRow {
  project_id: string;
  ini: string;
  name: string;
  role: string;
}
interface MilestoneRow {
  project_id: string;
  id: string;
  name: string;
  status: MilestoneStatus;
  month: string;
  base_fte: number;
  base_time: number;
  stretch_fte: number;
  stretch_time: number;
}
interface MetricRow {
  project_id: string;
  milestone_id: string;
  id: string;
  label: string;
  base: number;
  stretch: number;
}
interface LatestRow {
  project_id: string;
  milestone_id: string;
  metric_id: string;
  value: number;
}
interface GovRow {
  project_id: string;
  id: string;
  cat: string;
  name: string;
  status: GovernanceItem["status"];
  owner: string;
  date: string | null;
  detail: string;
  link: string | null;
}
interface ReleaseRow {
  project_id: string;
  id: string;
  name: string;
  month: string;
}
interface RelMsRow {
  project_id: string;
  release_id: string;
  milestone_id: string;
}
interface CritRow {
  project_id: string;
  release_id: string;
  type: "gate" | "gov" | "manual";
  milestone_id: string | null;
  governance_id: string | null;
  ok: number | null;
  label: string;
}
interface DocRow {
  doc: string;
}
interface WorkspaceRow {
  user_name: string;
  user_ini: string;
}
interface RepoStatRow {
  project_id: string;
  repo: string;
  branch: string;
  lang: string | null;
  coverage: number | null;
  quality: string | null;
  measured_at: string;
}
interface PrRow {
  project_id: string;
  repo: string;
  number: number;
  title: string;
  author: string;
  status: PullRequest["status"];
  checks: PullRequest["checks"];
  additions: number;
  deletions: number;
  opened_at: string;
  merged_at: string | null;
  updated_at: string;
  reviewers: string;
  url: string | null;
}
interface BuildRow {
  project_id: string;
  repo: string;
  id: string;
  branch: string;
  kind: Build["kind"];
  status: Build["status"];
  note: string;
  started_at: string;
  duration_s: number;
  url: string | null;
}
interface CommitRow {
  project_id: string;
  repo: string;
  day: string;
  author: string;
  count: number;
}
interface SyncRow {
  project_id: string;
  source: string;
  started_at: string;
  finished_at: string;
  ok: number;
  message: string;
}
interface ReadingRow {
  project_id: string;
  milestone_id: string;
  metric_id: string;
  value: number;
  recorded_at: string;
  source: "eval" | "manual";
}

const LATEST_SQL = `
  SELECT r.project_id, r.milestone_id, r.metric_id, r.value
  FROM metric_readings r
  WHERE r.seq = (
    SELECT r2.seq FROM metric_readings r2
    WHERE r2.project_id = r.project_id AND r2.milestone_id = r.milestone_id AND r2.metric_id = r.metric_id
    ORDER BY r2.recorded_at DESC, r2.seq DESC LIMIT 1
  )`;

const key3 = (a: string, b: string, c: string): string => `${a} ${b} ${c}`;

const asTier = (t: number | null): RiskTier | null => (t === 1 || t === 2 || t === 3 ? t : null);

const groupBy = <T>(rows: T[], k: (r: T) => string): Map<string, T[]> => {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const list = m.get(k(r));
    if (list) list.push(r);
    else m.set(k(r), [r]);
  }
  return m;
};

const toCriterion = (c: CritRow): Criterion => {
  switch (c.type) {
    case "gate":
      return { type: "gate", ms: c.milestone_id ?? "", label: c.label };
    case "gov":
      return { type: "gov", gid: c.governance_id ?? "", label: c.label };
    case "manual":
      return { type: "manual", ok: c.ok === 1, label: c.label };
  }
};

export const loadState = (db: Database, now: Date = new Date()): AppState => {
  const projects = db.query<ProjectRow, []>("SELECT * FROM projects ORDER BY sort").all();
  const repos = groupBy(db.query<RepoRow, []>("SELECT * FROM project_repos ORDER BY sort").all(), (r) => r.project_id);
  const members = groupBy(db.query<MemberRow, []>("SELECT * FROM team_members ORDER BY sort").all(), (r) => r.project_id);
  const milestones = groupBy(db.query<MilestoneRow, []>("SELECT * FROM milestones ORDER BY sort").all(), (r) => r.project_id);
  const metrics = groupBy(db.query<MetricRow, []>("SELECT * FROM metrics ORDER BY sort").all(), (r) => `${r.project_id} ${r.milestone_id}`);
  const latest = new Map(db.query<LatestRow, []>(LATEST_SQL).all().map((r) => [key3(r.project_id, r.milestone_id, r.metric_id), r.value]));
  const gov = groupBy(db.query<GovRow, []>("SELECT * FROM governance_items ORDER BY sort").all(), (r) => r.project_id);
  const releases = groupBy(db.query<ReleaseRow, []>("SELECT * FROM releases ORDER BY sort").all(), (r) => r.project_id);
  const relMs = groupBy(db.query<RelMsRow, []>("SELECT * FROM release_milestones ORDER BY sort").all(), (r) => `${r.project_id} ${r.release_id}`);
  const crits = groupBy(db.query<CritRow, []>("SELECT * FROM release_criteria ORDER BY sort").all(), (r) => `${r.project_id} ${r.release_id}`);
  const dev = loadDevFacts(db);

  const out: AppState = { asOf: now.toISOString(), syncSource: null, workspace: loadWorkspace(db), projects: [], releases: {}, dev: {}, agents: [], feed: [], upcoming: [] };
  for (const p of projects) {
    const ms: Milestone[] = (milestones.get(p.id) ?? []).map((m) => ({
      id: m.id,
      name: m.name,
      status: m.status,
      month: m.month,
      impact: { base: { fte: m.base_fte, time: m.base_time }, stretch: { fte: m.stretch_fte, time: m.stretch_time } },
      metrics: (metrics.get(`${p.id} ${m.id}`) ?? []).map(
        (x): Metric => ({ id: x.id, label: x.label, base: x.base, stretch: x.stretch, current: latest.get(key3(p.id, m.id, x.id)) ?? 0 }),
      ),
    }));
    const project: Project = {
      id: p.id,
      key: p.key,
      name: p.name,
      stage: p.stage,
      description: p.description,
      tier: asTier(p.tier),
      committee: p.committee_date && p.committee_ref ? { date: p.committee_date, ref: p.committee_ref } : null,
      repos: (repos.get(p.id) ?? []).map((r) => ({ name: r.name, url: r.url })),
      team: (members.get(p.id) ?? []).map((t) => ({ ini: t.ini, name: t.name, role: t.role })),
      targets: { fte: p.target_fte, time: p.target_time },
      milestones: ms,
      governance: (gov.get(p.id) ?? []).map(
        (g): GovernanceItem => ({
          cat: g.cat,
          id: g.id,
          name: g.name,
          status: g.status,
          owner: g.owner,
          date: g.date,
          detail: g.detail,
          ...(g.link ? { link: g.link } : {}),
        }),
      ),
    };
    out.projects.push(project);
    out.releases[p.id] = (releases.get(p.id) ?? []).map(
      (r): Release => ({
        id: r.id,
        name: r.name,
        month: r.month,
        milestoneIds: (relMs.get(`${p.id} ${r.id}`) ?? []).map((x) => x.milestone_id),
        criteria: (crits.get(`${p.id} ${r.id}`) ?? []).map(toCriterion),
      }),
    );
    const d = dev.get(p.id);
    if (d) out.dev[p.id] = d;
  }
  out.agents = db.query<DocRow, []>("SELECT doc FROM agents ORDER BY sort").all().map((r) => JSON.parse(r.doc) as Agent);
  out.feed = db.query<DocRow, []>("SELECT doc FROM feed_days ORDER BY sort").all().map((r) => JSON.parse(r.doc) as FeedDay);
  out.upcoming = db.query<DocRow, []>("SELECT doc FROM upcoming ORDER BY sort").all().map((r) => JSON.parse(r.doc) as Upcoming);
  return out;
};

/** Development facts per project; only projects with at least one synced row or run appear. */
export const loadDevFacts = (db: Database): Map<string, DevFacts> => {
  const out = new Map<string, DevFacts>();
  const get = (pid: string): DevFacts => {
    let f = out.get(pid);
    if (!f) {
      f = { repos: [], prs: [], builds: [], commits: [], lastSync: null };
      out.set(pid, f);
    }
    return f;
  };
  for (const r of db.query<RepoStatRow, []>("SELECT * FROM repo_stats ORDER BY project_id, repo").all())
    get(r.project_id).repos.push({ repo: r.repo, branch: r.branch, lang: r.lang, coverage: r.coverage, quality: r.quality, measuredAt: r.measured_at });
  for (const r of db.query<PrRow, []>("SELECT * FROM pull_requests ORDER BY project_id, updated_at DESC, repo, number").all())
    get(r.project_id).prs.push({
      repo: r.repo,
      number: r.number,
      title: r.title,
      author: r.author,
      status: r.status,
      checks: r.checks,
      add: r.additions,
      del: r.deletions,
      openedAt: r.opened_at,
      mergedAt: r.merged_at,
      updatedAt: r.updated_at,
      reviewers: JSON.parse(r.reviewers) as string[],
      url: r.url,
    });
  for (const r of db.query<BuildRow, []>("SELECT * FROM builds ORDER BY project_id, started_at DESC, repo, id").all())
    get(r.project_id).builds.push({ repo: r.repo, id: r.id, branch: r.branch, kind: r.kind, status: r.status, note: r.note, startedAt: r.started_at, durationS: r.duration_s, url: r.url });
  for (const r of db.query<CommitRow, []>("SELECT * FROM commit_days ORDER BY project_id, repo, day, author").all())
    get(r.project_id).commits.push({ repo: r.repo, day: r.day, author: r.author, count: r.count });
  for (const r of db
    .query<SyncRow, []>("SELECT s.* FROM sync_runs s WHERE s.seq = (SELECT MAX(seq) FROM sync_runs WHERE project_id = s.project_id)")
    .all())
    get(r.project_id).lastSync = { source: r.source, startedAt: r.started_at, finishedAt: r.finished_at, ok: r.ok === 1, message: r.message };
  return out;
};

export const recordSyncRun = (db: Database, pid: string, run: SyncRun): void => {
  db.query("INSERT INTO sync_runs (project_id, source, started_at, finished_at, ok, message) VALUES (?,?,?,?,?,?)").run(
    pid,
    run.source,
    run.startedAt,
    run.finishedAt,
    run.ok ? 1 : 0,
    run.message,
  );
};

/** Replace a project's synced facts wholesale and record the run that produced them. */
export const replaceDevFacts = (db: Database, pid: string, facts: Omit<DevFacts, "lastSync">, run: SyncRun): void => {
  if (!projectExists(db, pid)) throw new NotFound(`project ${pid} not found`);
  db.transaction(() => {
    for (const t of ["repo_stats", "pull_requests", "builds", "commit_days"]) db.query(`DELETE FROM ${t} WHERE project_id = ?`).run(pid);
    const qs = db.query("INSERT INTO repo_stats (project_id, repo, branch, lang, coverage, quality, measured_at) VALUES (?,?,?,?,?,?,?)");
    for (const r of facts.repos) qs.run(pid, r.repo, r.branch, r.lang, r.coverage, r.quality, r.measuredAt);
    const qp = db.query(
      "INSERT OR REPLACE INTO pull_requests (project_id, repo, number, title, author, status, checks, additions, deletions, opened_at, merged_at, updated_at, reviewers, url) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    );
    for (const p of facts.prs) qp.run(pid, p.repo, p.number, p.title, p.author, p.status, p.checks, p.add, p.del, p.openedAt, p.mergedAt, p.updatedAt, JSON.stringify(p.reviewers), p.url);
    const qb = db.query("INSERT OR REPLACE INTO builds (project_id, repo, id, branch, kind, status, note, started_at, duration_s, url) VALUES (?,?,?,?,?,?,?,?,?,?)");
    for (const b of facts.builds) qb.run(pid, b.repo, b.id, b.branch, b.kind, b.status, b.note, b.startedAt, b.durationS, b.url);
    const qc = db.query("INSERT OR REPLACE INTO commit_days (project_id, repo, day, author, count) VALUES (?,?,?,?,?)");
    for (const c of facts.commits) qc.run(pid, c.repo, c.day, c.author, c.count);
    recordSyncRun(db, pid, run);
  })();
};

export const loadWorkspace = (db: Database): Workspace => {
  const w = db.query<WorkspaceRow, []>("SELECT user_name, user_ini FROM workspace WHERE id = 1").get();
  return { user: { name: w?.user_name ?? "You", ini: w?.user_ini ?? "ME" } };
};

export const setWorkspace = (db: Database, w: WorkspaceInput): void => {
  db.query("INSERT OR REPLACE INTO workspace (id, user_name, user_ini) VALUES (1, ?, ?)").run(w.user.name, w.user.ini);
};

export const findProject = (state: AppState, pid: string): Project => {
  const p = state.projects.find((x) => x.id === pid);
  if (!p) throw new NotFound(`project ${pid} not found`);
  return p;
};

export const findMilestone = (state: AppState, pid: string, mid: string): Milestone => {
  const m = findProject(state, pid).milestones.find((x) => x.id === mid);
  if (!m) throw new NotFound(`milestone ${pid}/${mid} not found`);
  return m;
};

// ---- readings -----------------------------------------------------------

const metricExists = (db: Database, pid: string, mid: string, xid: string): boolean =>
  (db.query<{ n: number }, [string, string, string]>("SELECT COUNT(*) AS n FROM metrics WHERE project_id = ? AND milestone_id = ? AND id = ?").get(pid, mid, xid)?.n ?? 0) > 0;

export const listReadings = (db: Database, pid: string, mid: string, xid: string): MetricReading[] => {
  if (!metricExists(db, pid, mid, xid)) throw new NotFound(`metric ${pid}/${mid}/${xid} not found`);
  return db
    .query<ReadingRow, [string, string, string]>(
      "SELECT * FROM metric_readings WHERE project_id = ? AND milestone_id = ? AND metric_id = ? ORDER BY recorded_at, seq",
    )
    .all(pid, mid, xid)
    .map((r) => ({ projectId: r.project_id, milestoneId: r.milestone_id, metricId: r.metric_id, value: r.value, recordedAt: r.recorded_at, source: r.source }));
};

export const recordReading = (
  db: Database,
  pid: string,
  mid: string,
  xid: string,
  value: number,
  source: "eval" | "manual",
  at = new Date(),
): MetricReading => {
  if (!metricExists(db, pid, mid, xid)) throw new NotFound(`metric ${pid}/${mid}/${xid} not found`);
  const recordedAt = at.toISOString();
  db.query("INSERT INTO metric_readings (project_id, milestone_id, metric_id, value, recorded_at, source) VALUES (?,?,?,?,?,?)").run(
    pid,
    mid,
    xid,
    value,
    recordedAt,
    source,
  );
  return { projectId: pid, milestoneId: mid, metricId: xid, value, recordedAt, source };
};

// ---- milestones ---------------------------------------------------------

const milestoneExists = (db: Database, pid: string, mid: string): boolean =>
  (db.query<{ n: number }, [string, string]>("SELECT COUNT(*) AS n FROM milestones WHERE project_id = ? AND id = ?").get(pid, mid)?.n ?? 0) > 0;

const projectExists = (db: Database, pid: string): boolean =>
  (db.query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM projects WHERE id = ?").get(pid)?.n ?? 0) > 0;

/**
 * Create or replace a milestone and its metric definitions. A metric's
 * `current` is a reading: when it differs from the latest recorded value (or
 * no reading exists yet and it is non-zero) a manual reading is appended, so
 * eval history is never rewritten.
 */
export const upsertMilestone = (db: Database, pid: string, input: MilestoneInput, mode: "create" | "update", now = new Date()): void => {
  if (!projectExists(db, pid)) throw new NotFound(`project ${pid} not found`);
  const exists = milestoneExists(db, pid, input.id);
  if (mode === "create" && exists) throw new Conflict(`milestone ${pid}/${input.id} already exists`);
  if (mode === "update" && !exists) throw new NotFound(`milestone ${pid}/${input.id} not found`);

  db.transaction(() => {
    if (exists) {
      db.query(
        "UPDATE milestones SET name = ?, status = ?, month = ?, base_fte = ?, base_time = ?, stretch_fte = ?, stretch_time = ? WHERE project_id = ? AND id = ?",
      ).run(input.name, input.status, input.month, input.impact.base.fte, input.impact.base.time, input.impact.stretch.fte, input.impact.stretch.time, pid, input.id);
    } else {
      const sort = db.query<{ s: number }, [string]>("SELECT COALESCE(MAX(sort), -1) + 1 AS s FROM milestones WHERE project_id = ?").get(pid)?.s ?? 0;
      db.query(
        "INSERT INTO milestones (project_id, id, name, status, month, base_fte, base_time, stretch_fte, stretch_time, sort) VALUES (?,?,?,?,?,?,?,?,?,?)",
      ).run(pid, input.id, input.name, input.status, input.month, input.impact.base.fte, input.impact.base.time, input.impact.stretch.fte, input.impact.stretch.time, sort);
    }
    const keep = input.metrics.map((x) => x.id);
    const existing = db
      .query<{ id: string }, [string, string]>("SELECT id FROM metrics WHERE project_id = ? AND milestone_id = ?")
      .all(pid, input.id)
      .map((r) => r.id);
    for (const id of existing) {
      if (!keep.includes(id)) db.query("DELETE FROM metrics WHERE project_id = ? AND milestone_id = ? AND id = ?").run(pid, input.id, id);
    }
    input.metrics.forEach((x, i) => {
      if (existing.includes(x.id)) {
        db.query("UPDATE metrics SET label = ?, base = ?, stretch = ?, sort = ? WHERE project_id = ? AND milestone_id = ? AND id = ?").run(
          x.label,
          x.base,
          x.stretch,
          i,
          pid,
          input.id,
          x.id,
        );
      } else {
        db.query("INSERT INTO metrics (project_id, milestone_id, id, label, base, stretch, sort) VALUES (?,?,?,?,?,?,?)").run(pid, input.id, x.id, x.label, x.base, x.stretch, i);
      }
      const latest = db
        .query<{ value: number }, [string, string, string]>(
          "SELECT value FROM metric_readings WHERE project_id = ? AND milestone_id = ? AND metric_id = ? ORDER BY recorded_at DESC, seq DESC LIMIT 1",
        )
        .get(pid, input.id, x.id);
      const currentStored = latest?.value ?? 0;
      if (x.current !== currentStored) recordReading(db, pid, input.id, x.id, x.current, "manual", now);
    });
  })();
};

export const deleteMilestone = (db: Database, pid: string, mid: string): void => {
  if (!milestoneExists(db, pid, mid)) throw new NotFound(`milestone ${pid}/${mid} not found`);
  // Release criteria that reference this milestone are intentionally left in
  // place: they resolve to "milestone not found" / not-met at read time.
  db.query("DELETE FROM milestones WHERE project_id = ? AND id = ?").run(pid, mid);
};

// ---- projects ------------------------------------------------------------

/** Create or replace a project's own facts (details, team, repos, targets). Children are untouched. */
export const upsertProject = (db: Database, input: ProjectInput, mode: "create" | "update"): void => {
  const exists = projectExists(db, input.id);
  if (mode === "create" && exists) throw new Conflict(`project ${input.id} already exists`);
  if (mode === "update" && !exists) throw new NotFound(`project ${input.id} not found`);
  db.transaction(() => {
    if (exists) {
      db.query(
        "UPDATE projects SET key = ?, name = ?, stage = ?, description = ?, tier = ?, committee_date = ?, committee_ref = ?, target_fte = ?, target_time = ? WHERE id = ?",
      ).run(input.key, input.name, input.stage, input.description, input.tier, input.committee?.date ?? null, input.committee?.ref ?? null, input.targets.fte, input.targets.time, input.id);
    } else {
      const sort = db.query<{ s: number }, []>("SELECT COALESCE(MAX(sort), -1) + 1 AS s FROM projects").get()?.s ?? 0;
      db.query(
        "INSERT INTO projects (id, key, name, stage, description, tier, committee_date, committee_ref, target_fte, target_time, sort) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      ).run(input.id, input.key, input.name, input.stage, input.description, input.tier, input.committee?.date ?? null, input.committee?.ref ?? null, input.targets.fte, input.targets.time, sort);
    }
    db.query("DELETE FROM project_repos WHERE project_id = ?").run(input.id);
    input.repos.forEach((r, i) => db.query("INSERT INTO project_repos (project_id, name, url, sort) VALUES (?,?,?,?)").run(input.id, r.name, r.url, i));
    db.query("DELETE FROM team_members WHERE project_id = ?").run(input.id);
    input.team.forEach((t, i) => db.query("INSERT INTO team_members (project_id, ini, name, role, sort) VALUES (?,?,?,?,?)").run(input.id, t.ini, t.name, t.role, i));
  })();
};

/** Deletes a project and everything under it (milestones, readings, governance, releases, dev activity). */
export const deleteProject = (db: Database, pid: string): void => {
  const res = db.query("DELETE FROM projects WHERE id = ?").run(pid);
  if (res.changes === 0) throw new NotFound(`project ${pid} not found`);
};

// ---- targets & governance ----------------------------------------------

export const setTargets = (db: Database, pid: string, t: TargetsInput): void => {
  if (!projectExists(db, pid)) throw new NotFound(`project ${pid} not found`);
  db.query("UPDATE projects SET target_fte = ?, target_time = ? WHERE id = ?").run(t.fte, t.time, pid);
};

export const updateGovernance = (db: Database, pid: string, gid: string, g: GovernanceInput): void => {
  const res = db
    .query(
      "UPDATE governance_items SET cat = COALESCE(?, cat), name = COALESCE(?, name), status = ?, owner = ?, date = ?, detail = ?, link = ? WHERE project_id = ? AND id = ?",
    )
    .run(g.cat ?? null, g.name ?? null, g.status, g.owner, g.date, g.detail, g.link ?? null, pid, gid);
  if (res.changes === 0) throw new NotFound(`governance item ${pid}/${gid} not found`);
};

export const createGovernanceItem = (db: Database, pid: string, g: GovernanceItemInput): void => {
  if (!projectExists(db, pid)) throw new NotFound(`project ${pid} not found`);
  const dup = db.query<{ n: number }, [string, string]>("SELECT COUNT(*) AS n FROM governance_items WHERE project_id = ? AND id = ?").get(pid, g.id)?.n ?? 0;
  if (dup > 0) throw new Conflict(`governance item ${pid}/${g.id} already exists`);
  const sort = db.query<{ s: number }, [string]>("SELECT COALESCE(MAX(sort), -1) + 1 AS s FROM governance_items WHERE project_id = ?").get(pid)?.s ?? 0;
  db.query("INSERT INTO governance_items (project_id, id, cat, name, status, owner, date, detail, link, sort) VALUES (?,?,?,?,?,?,?,?,?,?)").run(
    pid,
    g.id,
    g.cat,
    g.name,
    g.status,
    g.owner,
    g.date,
    g.detail,
    g.link ?? null,
    sort,
  );
};

/** Release criteria that reference the item stay in place and resolve to "not tracked". */
export const deleteGovernanceItem = (db: Database, pid: string, gid: string): void => {
  const res = db.query("DELETE FROM governance_items WHERE project_id = ? AND id = ?").run(pid, gid);
  if (res.changes === 0) throw new NotFound(`governance item ${pid}/${gid} not found`);
};

// ---- releases ------------------------------------------------------------

const releaseExists = (db: Database, pid: string, rid: string): boolean =>
  (db.query<{ n: number }, [string, string]>("SELECT COUNT(*) AS n FROM releases WHERE project_id = ? AND id = ?").get(pid, rid)?.n ?? 0) > 0;

/** Create or replace a release: its milestone list and criteria are replaced wholesale (they are references, not state). */
export const upsertRelease = (db: Database, pid: string, input: ReleaseInput, mode: "create" | "update"): void => {
  if (!projectExists(db, pid)) throw new NotFound(`project ${pid} not found`);
  const exists = releaseExists(db, pid, input.id);
  if (mode === "create" && exists) throw new Conflict(`release ${pid}/${input.id} already exists`);
  if (mode === "update" && !exists) throw new NotFound(`release ${pid}/${input.id} not found`);
  db.transaction(() => {
    if (exists) {
      db.query("UPDATE releases SET name = ?, month = ? WHERE project_id = ? AND id = ?").run(input.name, input.month, pid, input.id);
    } else {
      const sort = db.query<{ s: number }, [string]>("SELECT COALESCE(MAX(sort), -1) + 1 AS s FROM releases WHERE project_id = ?").get(pid)?.s ?? 0;
      db.query("INSERT INTO releases (project_id, id, name, month, sort) VALUES (?,?,?,?,?)").run(pid, input.id, input.name, input.month, sort);
    }
    db.query("DELETE FROM release_milestones WHERE project_id = ? AND release_id = ?").run(pid, input.id);
    input.milestoneIds.forEach((mid, i) =>
      db.query("INSERT INTO release_milestones (project_id, release_id, milestone_id, sort) VALUES (?,?,?,?)").run(pid, input.id, mid, i),
    );
    db.query("DELETE FROM release_criteria WHERE project_id = ? AND release_id = ?").run(pid, input.id);
    const crit = db.query("INSERT INTO release_criteria (project_id, release_id, sort, type, milestone_id, governance_id, ok, label) VALUES (?,?,?,?,?,?,?,?)");
    input.criteria.forEach((c, i) => {
      switch (c.type) {
        case "gate":
          crit.run(pid, input.id, i, "gate", c.ms, null, null, c.label);
          break;
        case "gov":
          crit.run(pid, input.id, i, "gov", null, c.gid, null, c.label);
          break;
        case "manual":
          crit.run(pid, input.id, i, "manual", null, null, c.ok ? 1 : 0, c.label);
          break;
      }
    });
  })();
};

export const deleteRelease = (db: Database, pid: string, rid: string): void => {
  const res = db.query("DELETE FROM releases WHERE project_id = ? AND id = ?").run(pid, rid);
  if (res.changes === 0) throw new NotFound(`release ${pid}/${rid} not found`);
};

// ---- JSON documents ------------------------------------------------------

export const setAgents = (db: Database, agents: AgentsInput): void => {
  db.transaction(() => {
    db.query("DELETE FROM agents").run();
    agents.forEach((a, i) => db.query("INSERT INTO agents (id, sort, doc) VALUES (?,?,?)").run(a.id, i, JSON.stringify(a)));
  })();
};

export const setFeed = (db: Database, feed: FeedInput): void => {
  db.transaction(() => {
    db.query("DELETE FROM feed_days").run();
    feed.forEach((f, i) => db.query("INSERT INTO feed_days (sort, doc) VALUES (?,?)").run(i, JSON.stringify(f)));
  })();
};

export const setUpcoming = (db: Database, items: UpcomingInput): void => {
  db.transaction(() => {
    db.query("DELETE FROM upcoming").run();
    items.forEach((u, i) => db.query("INSERT INTO upcoming (sort, doc) VALUES (?,?)").run(i, JSON.stringify(u)));
  })();
};
