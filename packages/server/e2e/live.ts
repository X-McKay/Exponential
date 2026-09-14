// Opt-in live provider smoke test. Creates clearly labeled sample projects in the selected instance.
import { strict as assert } from "node:assert";
import { resolve } from "node:path";
import type { AppState, Project, SetupDraft } from "@valueflow/domain";
import type { CommsAssignment, CommsArtifact, CommsRun, PMAssignment, PMRun } from "@valueflow/shared";
import { compose, fromDraft } from "../../web/src/editors/SetupWizard.tsx";

if (!process.argv.includes("--confirm-fixtures") || !process.env.E2E_BASE_URL) throw new Error("Set E2E_BASE_URL and pass --confirm-fixtures. This creates sample projects and uses the configured provider.");
const base = process.env.E2E_BASE_URL;
const call = async <T>(path: string, method = "GET", body?: unknown): Promise<T> => {
  const response = await fetch(base + path, { method,
    headers: { "x-valueflow-user": "owner", "x-valueflow-role": "admin", ...(body instanceof FormData || body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }), signal: AbortSignal.timeout(260_000),
  });
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
  return await response.json() as T;
};
const state = await call<AppState>("/api/state");
assert.ok(state.llm, "Configure the provider in Workspace settings first.");
console.log(`Live provider: ${state.llm.model} at ${state.llm.baseUrl}`);
const created: Project[] = [];
for (const [file, name] of [["invoice-review-charter.md", "Invoice Review Assistant"], ["knowledge-search-charter.md", "Internal Knowledge Search"]]) {
  const form = new FormData(); form.set("name", `${name} — sample`);
  form.append("file", Bun.file(resolve(import.meta.dir, "../../../docs/samples", file!)), file);
  console.log(`Analyzing ${file}`);
  const draft = await call<SetupDraft>("/api/setup", "POST", form);
  assert.ok(draft.draft.milestones.length, "Provider should extract milestone suggestions");
  const input = compose(`${name} — sample`, `SAMPLE-${created.length + 1}`, fromDraft(draft.draft), new Set(["committee"]), [...state.projects, ...created].map(p => p.id), "ME");
  // All samples describe plans, not measurements or completed delivery.
  input.project.committee = null;
  input.project.repos = [];
  for (const milestone of input.milestones) { milestone.status = "backlog"; for (const metric of milestone.metrics) metric.current = 0; }
  for (const g of input.governance) if (g.status === "approved") g.status = "missing";
  const project = await call<Project>(`/api/setup/${draft.id}/create`, "POST", input); created.push(project);
  assert.equal(project.committee, null);
  assert.ok(project.milestones.every(m => m.metrics.every(x => x.readAt === null)));
  console.log(`PASS live upload, review and creation: ${project.name} (${project.milestones.length} milestones)`);
}
const project = created[0]!;
const pm = await call<PMAssignment>("/api/pm/assignments", "POST", { projectId: project.id, owner: "ME", objective: "Assess readiness using recorded evidence. Do not claim approvals, deployment or observed savings." });
console.log("Running live PM assessment");
const assessment = await call<PMRun>(`/api/pm/assignments/${pm.id}/run`, "POST", {});
assert.notEqual(assessment.state, "failed", assessment.error ?? "PM failed"); assert.ok(assessment.output.trim());
console.log(`PASS live PM assessment: ${assessment.state}`);
const comms = await call<CommsAssignment>("/api/comms/assignments", "POST", { projectId: project.id, owner: "ME", objective: "Draft a brief update for this fictional pilot. No sending.", audience: "Internal pilot team", format: "executive_update" });
console.log("Running live communications draft");
const draft = await call<CommsRun>(`/api/comms/assignments/${comms.id}/run`, "POST", {});
assert.notEqual(draft.state, "failed", draft.error ?? "Comms failed"); assert.ok(draft.output.trim());
const artifacts = await call<CommsArtifact[]>(`/api/comms/artifacts?projectId=${project.id}`);
assert.ok(artifacts.some(a => a.runId === draft.id && a.status === "draft"));
console.log("PASS live communications artifact saved as draft");
console.log("Live provider smoke test passed. Sample projects and drafts retained for review; no external messages sent.");
