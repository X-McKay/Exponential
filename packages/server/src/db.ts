import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { migrate } from "./migrations.ts";

/** Repo-root data/valueflow.sqlite regardless of the process cwd. */
export const DEFAULT_DB_PATH = resolve(import.meta.dir, "../../../data/valueflow.sqlite");

/** Open (and migrate) a database. Use ":memory:" for tests. */
export const openDb = (path: string = process.env.VALUEFLOW_DB ?? DEFAULT_DB_PATH): Database => {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, strict: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  return db;
};
