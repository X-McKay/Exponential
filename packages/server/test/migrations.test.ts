import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { loadState } from "../src/repo.ts";
import { MIGRATIONS, migrate } from "../src/migrations.ts";

/** Build a database at the version immediately before the evidence changes. */
const preEvidenceDb = (): Database => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  MIGRATIONS.slice(0, -2).forEach((sql, i) => {
    db.exec(sql);
    db.query("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(i + 1, "2026-09-01T00:00:00.000Z");
  });
  db.query("INSERT INTO projects (id, key, name, stage, description, tier, committee_date, committee_ref, target_fte, target_time, sort) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(
    "legacy",
    "LEG",
    "Legacy project",
    "pilot",
    "preserve me",
    null,
    null,
    null,
    10,
    20,
    0,
  );
  db.query("INSERT INTO milestones (project_id, id, name, status, month, base_fte, base_time, stretch_fte, stretch_time, sort) VALUES (?,?,?,?,?,?,?,?,?,?)").run(
    "legacy",
    "MS-1",
    "Legacy milestone",
    "shipped",
    "2026-08",
    5,
    6,
    8,
    9,
    0,
  );
  db.query("INSERT INTO metrics (project_id, milestone_id, id, label, base, stretch, sort) VALUES (?,?,?,?,?,?,?)").run("legacy", "MS-1", "quality", "Quality", 80, 95, 0);
  db.query("INSERT INTO metric_readings (project_id, milestone_id, metric_id, value, recorded_at, source) VALUES (?,?,?,?,?,?)").run(
    "legacy",
    "MS-1",
    "quality",
    91,
    "2026-08-20T00:00:00.000Z",
    "eval",
  );
  return db;
};

describe("evidence migration", () => {
  test("preserves legacy facts, starts history unknown, checks foreign keys, and is idempotent", () => {
    const db = preEvidenceDb();
    migrate(db);

    expect(db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM projects WHERE id = 'legacy'").get()?.n).toBe(1);
    expect(db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM milestones WHERE project_id = 'legacy' AND id = 'MS-1'").get()?.n).toBe(1);
    expect(db.query<{ n: number; value: number }, []>("SELECT COUNT(*) AS n, value FROM metric_readings WHERE project_id = 'legacy'").get()).toEqual({ n: 1, value: 91 });
    expect(db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM milestone_snapshots").get()?.n).toBe(0);
    expect(db.query<{ created_at: string | null }, []>("SELECT created_at FROM milestones WHERE project_id = 'legacy' AND id = 'MS-1'").get()?.created_at).toBeNull();
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);

    const state = loadState(db, new Date("2026-09-12T00:00:00.000Z"));
    expect(state.projects[0]?.historicalMilestones).toBeUndefined();
    expect(state.projects[0]?.milestones[0]?.metrics[0]?.readAt).toBe("2026-08-20T00:00:00.000Z");

    migrate(db);
    expect(db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM milestone_snapshots").get()?.n).toBe(0);
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
