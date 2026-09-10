// ================= sync =================
//
// Pulls development facts for a project from the configured source and
// replaces what is stored. A failed fetch records the failure and keeps the
// previous facts, so a flaky API never blanks a page.

import type { Database } from "bun:sqlite";
import { ACTIVITY_DAYS } from "@valueflow/domain";
import type { Project, SyncRun } from "@valueflow/domain";
import type { RepoSnapshot, RepoSource } from "./connectors/index.ts";
import { loadState, recordDevEvents, recordSyncRun, replaceDevFacts } from "./repo.ts";

export const syncProject = async (db: Database, source: RepoSource, project: Project, now: Date, sinceDays = ACTIVITY_DAYS): Promise<SyncRun> => {
  const startedAt = now.toISOString();
  try {
    const snapshots: RepoSnapshot[] = [];
    for (const repo of project.repos) snapshots.push(await source.fetchRepo(repo, { projectId: project.id, now, sinceDays, team: project.team }));
    const run: SyncRun = {
      source: source.name,
      startedAt,
      finishedAt: new Date().toISOString(),
      ok: true,
      message: `${snapshots.length} repo${snapshots.length === 1 ? "" : "s"}, ${snapshots.reduce((a, s) => a + s.prs.length, 0)} PRs, ${snapshots.reduce((a, s) => a + s.builds.length, 0)} builds`,
    };
    const facts = {
      repos: snapshots.map((s) => s.stat),
      prs: snapshots.flatMap((s) => s.prs),
      builds: snapshots.flatMap((s) => s.builds),
      commits: snapshots.flatMap((s) => s.commits),
    };
    replaceDevFacts(db, project.id, facts, run);
    recordDevEvents(db, project.id, facts, now);
    return run;
  } catch (e) {
    const run: SyncRun = { source: source.name, startedAt, finishedAt: new Date().toISOString(), ok: false, message: e instanceof Error ? e.message : String(e) };
    recordSyncRun(db, project.id, run);
    return run;
  }
};

/** Sync every project; returns one run per project id. */
export const syncAll = async (db: Database, source: RepoSource, now: Date): Promise<Record<string, SyncRun>> => {
  const out: Record<string, SyncRun> = {};
  for (const p of loadState(db, now).projects) out[p.id] = await syncProject(db, source, p, now);
  return out;
};

/** Sync only projects that have never been synced (first boot after a migration, new projects). */
export const syncMissing = async (db: Database, source: RepoSource, now: Date): Promise<Record<string, SyncRun>> => {
  const out: Record<string, SyncRun> = {};
  const state = loadState(db, now);
  for (const p of state.projects) if (!state.dev[p.id]?.lastSync) out[p.id] = await syncProject(db, source, p, now);
  return out;
};
