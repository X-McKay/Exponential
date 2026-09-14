import { expect, test } from "bun:test";
import { openDb } from "../src/db.ts";
import { seed, SEED_NOW } from "../src/seed.ts";
import { recoverInterruptedRuns } from "../src/recovery.ts";
import { loadState } from "../src/repo.ts";

test("restart marks orphaned runs failed without altering completed work", () => {
  const db = openDb(":memory:");
  seed(db);
  const before = loadState(db, SEED_NOW).runs;
  const working = before.filter((r) => r.state === "working" || r.state === "queued");
  const completed = before.filter((r) => r.state !== "working" && r.state !== "queued");
  expect(recoverInterruptedRuns(db, SEED_NOW)).toBe(working.length);
  const after = loadState(db, SEED_NOW).runs;
  expect(after.filter((r) => working.some((w) => w.id === r.id)).every((r) => r.state === "failed" && r.error?.includes("restarted"))).toBe(true);
  expect(after.filter((r) => completed.some((c) => c.id === r.id))).toEqual(completed);
  expect(recoverInterruptedRuns(db, SEED_NOW)).toBe(0);
  db.close();
});
