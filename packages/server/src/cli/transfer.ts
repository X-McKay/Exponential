// Move a whole workspace as one JSON document.
//
//   bun run workspace:export > workspace.json
//   bun run workspace:import -- workspace.json             into an empty workspace
//   bun run workspace:import -- workspace.json --replace   replacing what is there
import { WorkspaceExportSchema } from "@valueflow/shared";
import { openDb } from "../db.ts";
import { loadDotEnv } from "../env.ts";
import { initializeWorkspace } from "../seed.ts";
import { exportWorkspace, importWorkspace } from "../transfer.ts";

loadDotEnv();
const [command, ...rest] = process.argv.slice(2);
const now = process.env.VALUEFLOW_NOW ? new Date(process.env.VALUEFLOW_NOW) : new Date();
const db = openDb();
initializeWorkspace(db);
if (command === "export") {
  console.log(JSON.stringify(exportWorkspace(db, now), null, 2));
} else if (command === "import") {
  const file = rest.find((a) => !a.startsWith("--"));
  if (!file) throw new Error("usage: transfer import <file.json> [--replace]");
  const parsed = WorkspaceExportSchema.safeParse(JSON.parse(await Bun.file(file).text()));
  if (!parsed.success) throw new Error(`not a workspace export: ${parsed.error.issues[0]?.path.join(".")}: ${parsed.error.issues[0]?.message}`);
  const summary = importWorkspace(db, { document: parsed.data, replace: rest.includes("--replace") }, now);
  console.error(`imported ${summary.projects} projects, ${summary.milestones} milestones, ${summary.governance} governance items, ${summary.releases} releases, ${summary.readings} readings, ${summary.proposals} proposals, ${summary.runs} runs${summary.skipped ? `; skipped ${summary.skipped} dangling records` : ""}${summary.replaced ? " (replaced the previous workspace)" : ""}`);
} else {
  throw new Error("usage: transfer export | transfer import <file.json> [--replace]");
}
