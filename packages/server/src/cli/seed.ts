// Re-seed the database from the mockup fixtures. Destroys existing data.
import { existsSync, unlinkSync } from "node:fs";
import { DEFAULT_DB_PATH, openDb } from "../db.ts";
import { loadDotEnv } from "../env.ts";
import { seed } from "../seed.ts";

loadDotEnv();
const path = process.env.VALUEFLOW_DB ?? DEFAULT_DB_PATH;
for (const f of [path, `${path}-wal`, `${path}-shm`]) if (existsSync(f)) unlinkSync(f);
const db = openDb(path);
const pinned = process.env.VALUEFLOW_NOW ? new Date(process.env.VALUEFLOW_NOW) : new Date();
seed(db, undefined, pinned);
console.log(`seeded ${path}`);
