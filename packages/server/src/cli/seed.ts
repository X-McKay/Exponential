// Re-seed the database from the demo fixtures. Destroys existing data.
//
//   bun run demo:reset                 the curated demo workspace
//   bun run demo:reset -- --synthetic  a generated workspace (SEED_SYNTHETIC=<seed>, SEED_PROJECTS=<n>)
//   bun run demo:reset -- --proposals  also stage example proposals in the inbox
import { existsSync, unlinkSync } from "node:fs";
import { syntheticState } from "@valueflow/domain";
import { DEFAULT_DB_PATH, openDb } from "../db.ts";
import { loadDotEnv } from "../env.ts";
import { fixtureState, seed, seedProposals } from "../seed.ts";

loadDotEnv();
const args = new Set(process.argv.slice(2));
const path = process.env.VALUEFLOW_DB ?? DEFAULT_DB_PATH;
for (const f of [path, `${path}-wal`, `${path}-shm`]) if (existsSync(f)) unlinkSync(f);
const db = openDb(path);
const pinned = process.env.VALUEFLOW_NOW ? new Date(process.env.VALUEFLOW_NOW) : new Date();
const synthetic = args.has("--synthetic") || process.env.SEED_SYNTHETIC !== undefined;
const state = synthetic
  ? syntheticState({ seed: Number(process.env.SEED_SYNTHETIC ?? 1) || 1, projects: Number(process.env.SEED_PROJECTS ?? 6) || 6, asOf: pinned.toISOString() })
  : fixtureState();
seed(db, state, pinned);
const proposals = args.has("--proposals") || synthetic ? seedProposals(db, pinned).length : 0;
console.log(`seeded ${path} with ${state.projects.length} ${synthetic ? "synthetic" : "demo"} projects${proposals ? ` and ${proposals} pending proposals` : ""}`);
