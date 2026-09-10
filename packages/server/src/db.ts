import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { migrate } from "./migrations.ts";

export const DEFAULT_DB_PATH = "data/valueflow.sqlite";

/** Open (and migrate) a database. Use ":memory:" for tests. */
export const openDb = (path: string = process.env.VALUEFLOW_DB ?? DEFAULT_DB_PATH): Database => {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, strict: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  return db;
};
