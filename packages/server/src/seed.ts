import type { Database } from "bun:sqlite";
import { AGENTS, DEV, FEED, PROJECTS, RELEASES, SEED_ASOF, UPCOMING, WORKSPACE, addMonths, isMeasurable, monthsBetween, ymOf } from "@valueflow/domain";
import type { AppState, Metric } from "@valueflow/domain";

/** The instant the fixtures describe. Seeding at another time shifts every planned month and timestamp by the same offset. */
export const SEED_NOW = new Date(SEED_ASOF);
export const READINGS_PER_METRIC = 30;
const TRAILING_DAYS = 56;

/** Deterministic pseudo-random in [0, 1), same generator the mockup used. */
export const rnd = (seed: number): number => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

const hash = (s: string): number => {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 100000;
  return h;
};

/**
 * A trajectory shaped like the mockup's eval scatter: starts ~32pts under the
 * latest value, converges with a t^0.75 curve, noise decays toward the end,
 * and the final reading is exactly `current`.
 */
export const trajectory = (metric: Pick<Metric, "current">, seed: number, n = READINGS_PER_METRIC): number[] => {
  const start = Math.max(10, metric.current - 32);
  return Array.from({ length: n }, (_, i) => {
    if (i === n - 1) return metric.current;
    const t = i / (n - 1);
    const trend = start + (metric.current - start) * Math.pow(t, 0.75);
    const noise = (rnd(seed * 100 + i) - 0.5) * 14 * (1 - t * 0.55);
    return Math.round(Math.max(2, Math.min(99, trend + noise)) * 10) / 10;
  });
};

export const isSeeded = (db: Database): boolean =>
  (db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM projects").get()?.n ?? 0) > 0;

export const fixtureState = (): AppState => ({ asOf: SEED_ASOF, workspace: WORKSPACE, projects: PROJECTS, releases: RELEASES, dev: DEV, agents: AGENTS, feed: FEED, upcoming: UPCOMING });

export const seed = (db: Database, state: AppState = fixtureState(), now = SEED_NOW): void => {
  // Planned months are relative to the fixtures' own "today"; keep them the same distance from `now`.
  const shift = monthsBetween(ymOf(state.asOf), ymOf(now));
  const ym = (m: string): string => (shift === 0 ? m : addMonths(m, shift));
  const q = {
    project: db.query("INSERT INTO projects (id, key, name, stage, description, tier, committee_date, committee_ref, target_fte, target_time, sort) VALUES (?,?,?,?,?,?,?,?,?,?,?)"),
    repo: db.query("INSERT INTO project_repos (project_id, name, url, sort) VALUES (?,?,?,?)"),
    member: db.query("INSERT INTO team_members (project_id, ini, name, role, sort) VALUES (?,?,?,?,?)"),
    milestone: db.query("INSERT INTO milestones (project_id, id, name, status, month, base_fte, base_time, stretch_fte, stretch_time, sort) VALUES (?,?,?,?,?,?,?,?,?,?)"),
    metric: db.query("INSERT INTO metrics (project_id, milestone_id, id, label, base, stretch, sort) VALUES (?,?,?,?,?,?,?)"),
    reading: db.query("INSERT INTO metric_readings (project_id, milestone_id, metric_id, value, recorded_at, source) VALUES (?,?,?,?,?,?)"),
    gov: db.query("INSERT INTO governance_items (project_id, id, cat, name, status, owner, date, detail, link, sort) VALUES (?,?,?,?,?,?,?,?,?,?)"),
    release: db.query("INSERT INTO releases (project_id, id, name, month, sort) VALUES (?,?,?,?,?)"),
    relMs: db.query("INSERT INTO release_milestones (project_id, release_id, milestone_id, sort) VALUES (?,?,?,?)"),
    crit: db.query("INSERT INTO release_criteria (project_id, release_id, sort, type, milestone_id, governance_id, ok, label) VALUES (?,?,?,?,?,?,?,?)"),
    dev: db.query("INSERT INTO dev_activity (project_id, doc) VALUES (?,?)"),
    agent: db.query("INSERT INTO agents (id, sort, doc) VALUES (?,?,?)"),
    feed: db.query("INSERT INTO feed_days (sort, doc) VALUES (?,?)"),
    upcoming: db.query("INSERT INTO upcoming (sort, doc) VALUES (?,?)"),
    workspace: db.query("INSERT OR REPLACE INTO workspace (id, user_name, user_ini) VALUES (1, ?, ?)"),
  };

  db.transaction(() => {
    q.workspace.run(state.workspace.user.name, state.workspace.user.ini);
    state.projects.forEach((p, pi) => {
      q.project.run(p.id, p.key, p.name, p.stage, p.description, p.tier, p.committee?.date ?? null, p.committee?.ref ?? null, p.targets.fte, p.targets.time, pi);
      p.repos.forEach((r, i) => q.repo.run(p.id, r.name, r.url, i));
      p.team.forEach((t, i) => q.member.run(p.id, t.ini, t.name, t.role, i));
      p.milestones.forEach((m, mi) => {
        q.milestone.run(p.id, m.id, m.name, m.status, ym(m.month), m.impact.base.fte, m.impact.base.time, m.impact.stretch.fte, m.impact.stretch.time, mi);
        m.metrics.forEach((x, xi) => {
          q.metric.run(p.id, m.id, x.id, x.label, x.base, x.stretch, xi);
          if (!isMeasurable(m) || x.current <= 0) return;
          const values = trajectory(x, hash(`${p.id}/${m.id}/${x.id}`));
          values.forEach((v, i) => {
            const t = i / (values.length - 1);
            const at = new Date(now.getTime() - (1 - t) * TRAILING_DAYS * 86_400_000);
            q.reading.run(p.id, m.id, x.id, v, at.toISOString(), "eval");
          });
        });
      });
      p.governance.forEach((g, i) => q.gov.run(p.id, g.id, g.cat, g.name, g.status, g.owner, g.date, g.detail, g.link ?? null, i));
      (state.releases[p.id] ?? []).forEach((r, ri) => {
        q.release.run(p.id, r.id, r.name, ym(r.month), ri);
        r.milestoneIds.forEach((mid, i) => q.relMs.run(p.id, r.id, mid, i));
        r.criteria.forEach((c, i) => {
          switch (c.type) {
            case "gate":
              q.crit.run(p.id, r.id, i, "gate", c.ms, null, null, c.label);
              break;
            case "gov":
              q.crit.run(p.id, r.id, i, "gov", null, c.gid, null, c.label);
              break;
            case "manual":
              q.crit.run(p.id, r.id, i, "manual", null, null, c.ok ? 1 : 0, c.label);
              break;
          }
        });
      });
      const d = state.dev[p.id];
      if (d) q.dev.run(p.id, JSON.stringify(d));
    });
    state.agents.forEach((a, i) => q.agent.run(a.id, i, JSON.stringify(a)));
    state.feed.forEach((f, i) => q.feed.run(i, JSON.stringify(f)));
    state.upcoming.forEach((u, i) => q.upcoming.run(i, JSON.stringify(u)));
  })();
};

/** Seed only when empty; returns whether seeding happened. */
export const ensureSeeded = (db: Database, now = new Date()): boolean => {
  if (isSeeded(db)) return false;
  seed(db, fixtureState(), now);
  return true;
};
