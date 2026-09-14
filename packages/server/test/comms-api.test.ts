import { describe, expect, test } from "bun:test";
import type { CommsArtifact, CommsAssignment, CommsWorkspaceDetail } from "@valueflow/shared";
import { routes } from "@valueflow/shared";
import { createApp } from "../src/app.ts";
import { openDb } from "../src/db.ts";
import { seed } from "../src/seed.ts";
import type { Llm } from "../src/llm.ts";
import { recoverInterruptedRuns } from "../src/recovery.ts";

const NOW = new Date("2026-09-14T12:00:00Z");
const body = "# Executive update\n\nRelease review remains pending.\n\n<script>alert('inert download')</script>";
const fake: Llm = {
  model: async () => "fake",
  describe: () => ({ baseUrl: "http://fake", model: "fake", models: ["fake"], judgeModel: null, prices: {} }),
  chat: async () => ({ content: JSON.stringify({ summary: "Executive update drafted", body, attention: false, proposals: [] }), model: "fake", usage: null, truncated: false }),
};
function setup(llm: Llm | null = fake) {
  const db = openDb(":memory:"); seed(db);
  const app = createApp(db, { llm, now: () => NOW, autoJudge: false, autoCurate: false });
  const call = async (method: string, path: string, data?: unknown) => {
    const response = await app.handleApi(new Request(`http://test${path}`, { method, headers: data === undefined ? {} : { "content-type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data) }));
    if (!response) throw new Error(`Missing route ${path}`);
    return response;
  };
  return { db, call };
}
const createInput = { projectId: "ima", objective: "Draft the steering committee update", audience: "Steering committee", format: "executive_update", owner: "AM" };

describe("Communications Director API", () => {
  test("defaults to on demand, validates input, and protects stale edits", async () => {
    const { db, call } = setup();
    expect((await call("POST", routes.commsAssignments(), { ...createInput, audience: "" })).status).toBe(400);
    const created = await call("POST", routes.commsAssignments(), createInput);
    expect(created.status).toBe(201);
    const a = await created.json() as CommsAssignment;
    expect(a).toMatchObject({ cadence: "manual", onChange: false, enabled: true });
    expect((await call("PUT", routes.commsAssignment(a.id), { owner: "AL" })).status).toBe(400);
    expect((await call("PUT", routes.commsAssignment(a.id), { owner: "AL", expectedUpdatedAt: a.updatedAt })).status).toBe(200);
    expect((await call("PUT", routes.commsAssignment(a.id), { owner: "WRONG", expectedUpdatedAt: a.updatedAt })).status).toBe(409);
    const detail = await (await call("GET", routes.commsAssignment(a.id))).json() as CommsWorkspaceDetail;
    expect(detail.assignment).toMatchObject({ owner: "AL", objective: createInput.objective, audience: createInput.audience });
    db.close();
  });

  test("conversation, immutable draft versions, approval and exact safe downloads", async () => {
    const { db, call } = setup();
    const a = await (await call("POST", routes.commsAssignments(), createInput)).json() as CommsAssignment;
    expect((await call("POST", routes.commsRun(a.id), { instruction: "Emphasize the pending release decision." })).status).toBe(201);
    let detail = await (await call("GET", routes.commsAssignment(a.id))).json() as CommsWorkspaceDetail;
    expect(detail.messages.map(m => m.role)).toEqual(["user", "assistant"]);
    const v1 = detail.artifacts[0]!;
    expect(v1).toMatchObject({ version: 1, body, status: "draft", projectId: "ima" });
    expect((await call("PUT", routes.commsArtifact(v1.id), { status: "approved" })).status).toBe(200);
    await call("POST", routes.commsRun(a.id), { instruction: "Add a clearer next step." });
    detail = await (await call("GET", routes.commsAssignment(a.id))).json() as CommsWorkspaceDetail;
    expect(detail.messages).toHaveLength(4);
    expect(detail.artifacts.map(item => [item.version, item.status])).toEqual([[2, "draft"], [1, "approved"]]);
    expect(detail.artifacts[1]?.body).toBe(body);
    for (const format of ["md", "txt"] as const) {
      const downloaded = await call("GET", routes.commsDownload(v1.id, format));
      expect(downloaded.status).toBe(200);
      expect(downloaded.headers.get("content-disposition")).toMatch(/^attachment; filename="[a-z0-9_-]+\.(md|txt)"$/);
      expect(downloaded.headers.get("x-content-type-options")).toBe("nosniff");
      expect(downloaded.headers.get("content-type")).not.toContain("html");
      expect(await downloaded.text()).toBe(body);
    }
    expect((await call("GET", routes.commsDownload(v1.id).replace("format=md", "format=html"))).status).toBe(400);
    expect((await call("GET", routes.commsArtifacts("ima"))).status).toBe(200);
    expect(await (await call("GET", routes.commsArtifacts("onb"))).json() as CommsArtifact[]).toEqual([]);
    expect((await call("GET", routes.commsDownload("missing"))).status).toBe(404);
    const run = await (await call("GET", routes.run(v1.agentRunId))).json() as { output: string };
    expect(run.output).toBe(body);
    db.close();
  });

  test("missing model does not start work, restart clears only interrupted wrappers", async () => {
    const { db, call } = setup(null);
    const a = await (await call("POST", routes.commsAssignments(), createInput)).json() as CommsAssignment;
    expect((await call("POST", routes.commsRun(a.id), {})).status).toBe(409);
    db.query("INSERT INTO comms_runs (id,assignment_id,project_id,trigger,input_fingerprint,state,summary,output,started_at) VALUES ('interrupted',?,'ima','manual','test','working','Running','',?)").run(a.id, NOW.toISOString());
    recoverInterruptedRuns(db, NOW);
    const detail = await (await call("GET", routes.commsAssignment(a.id))).json() as CommsWorkspaceDetail;
    expect(detail.runs[0]).toMatchObject({ state: "failed", summary: "Interrupted by server restart" });
    expect(detail.artifacts).toEqual([]);
    db.close();
  });
});

test("conversation replies do not create artifacts or suppress the first scheduled draft", async () => {
  const { db, call } = setup();
  const a = await (await call("POST", routes.commsAssignments(), { ...createInput, onChange: true })).json() as CommsAssignment;
  await call("POST", routes.commsRun(a.id), { instruction: "What should we communicate?", mode: "conversation" });
  let detail = await (await call("GET", routes.commsAssignment(a.id))).json() as CommsWorkspaceDetail;
  expect(detail.messages).toHaveLength(2);
  expect(detail.artifacts).toEqual([]);
  expect(detail.assignment.lastInputFingerprint).toBeNull();
  const { runDueComms } = await import("../src/comms.ts");
  expect(await runDueComms(db, fake, NOW)).toHaveLength(1);
  detail = await (await call("GET", routes.commsAssignment(a.id))).json() as CommsWorkspaceDetail;
  expect(detail.artifacts[0]?.version).toBe(1);
  expect(await runDueComms(db, fake, new Date(NOW.getTime() + 8 * 86_400_000))).toEqual([]);
  db.close();
});

test("weekly and change drafting respect timing, PM handoff, and calendar changes", async () => {
  const { db, call } = setup();
  const { runDueComms, runAssignment, updateAssignment } = await import("../src/comms.ts");
  const a = await (await call("POST", routes.commsAssignments(), { ...createInput, cadence: "weekly" })).json() as CommsAssignment;
  await runAssignment(db, fake, a.id, NOW, "manual");
  expect(await runDueComms(db, fake, new Date(NOW.getTime() + 6 * 86_400_000))).toEqual([]);
  expect(await runDueComms(db, fake, new Date(NOW.getTime() + 7 * 86_400_000))).toHaveLength(1);
  const updated = updateAssignment(db, a.id, { expectedUpdatedAt: a.updatedAt, cadence: "manual", onChange: true }, NOW);
  expect(await runDueComms(db, fake, new Date(NOW.getTime() + 8 * 86_400_000))).toEqual([]);
  const { createAssignment: createPm, runAssignment: runPm } = await import("../src/pm.ts");
  const pm = createPm(db, { projectId: "ima", objective: "Review health", owner: "AM", enabled: true, onChange: false, cadence: "manual", commitments: [] }, NOW);
  await runPm(db, { ...fake, chat: async () => ({ content: JSON.stringify({ summary: "PM handoff", body: "PM EVIDENCE: release owner requires confirmation.", attention: true }), model: "fake", usage: null, truncated: false }) }, pm.id, NOW, "manual");
  let context = "";
  const capture: Llm = { ...fake, chat: async messages => { context = messages.map(m => m.content).join("\n"); return fake.chat(messages); } };
  expect(await runDueComms(db, capture, new Date(NOW.getTime() + 8 * 86_400_000))).toHaveLength(1);
  expect(context).toContain("PM EVIDENCE: release owner requires confirmation.");
  expect(context).toContain("Latest communications draft:");
  await call("POST", routes.calendar(), { id: "comms-review", proj: "ima", date: "2026-10-01", tab: "overview", text: "Steering decision", sub: null });
  expect(await runDueComms(db, fake, new Date(NOW.getTime() + 9 * 86_400_000))).toHaveLength(1);
  updateAssignment(db, a.id, { expectedUpdatedAt: updated.updatedAt, enabled: false }, NOW);
  expect(await runDueComms(db, fake, new Date(NOW.getTime() + 30 * 86_400_000))).toEqual([]);
  db.close();
});

test("failed scheduled drafting retries after cooldown and concurrent starts are rejected", async () => {
  const { db, call } = setup();
  const { getDetail, runAssignment, runDueComms } = await import("../src/comms.ts");
  const a = await (await call("POST", routes.commsAssignments(), { ...createInput, onChange: true })).json() as CommsAssignment;
  const offline: Llm = { ...fake, chat: async () => { throw new Error("offline"); } };
  expect((await runDueComms(db, offline, NOW))[0]?.state).toBe("failed");
  expect(getDetail(db, a.id).assignment.lastInputFingerprint).toBeNull();
  expect(getDetail(db, a.id).messages).toEqual([]);
  expect(await runDueComms(db, fake, new Date(NOW.getTime() + 30 * 60_000))).toEqual([]);
  expect(await runDueComms(db, fake, new Date(NOW.getTime() + 61 * 60_000))).toHaveLength(1);
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const slow: Llm = { ...fake, chat: async messages => { await wait; return fake.chat(messages); } };
  const first = runAssignment(db, slow, a.id, new Date(NOW.getTime() + 62 * 60_000), "manual", "Revise the draft");
  expect(getDetail(db, a.id).runs[0]?.agentRunId).toBeTruthy();
  await expect(runAssignment(db, slow, a.id, new Date(NOW.getTime() + 62 * 60_000), "manual", "Duplicate")).rejects.toThrow("already running");
  release(); await first;
  expect(getDetail(db, a.id).artifacts).toHaveLength(2);
  db.close();
});

test("empty model output cannot become an artifact", async () => {
  const empty: Llm = { ...fake, chat: async () => ({ content: JSON.stringify({ summary: "Empty", body: "   ", attention: false }), model: "fake", usage: null, truncated: false }) };
  const { db, call } = setup(empty);
  const a = await (await call("POST", routes.commsAssignments(), createInput)).json() as CommsAssignment;
  await call("POST", routes.commsRun(a.id), {});
  const detail = await (await call("GET", routes.commsAssignment(a.id))).json() as CommsWorkspaceDetail;
  expect(detail.runs[0]?.state).toBe("failed");
  expect(detail.artifacts).toEqual([]);
  expect(detail.assignment.lastInputFingerprint).toBeNull();
  expect((await call("POST", routes.commsRun(a.id), { mode: "conversation" })).status).toBe(400);
  db.close();
});
