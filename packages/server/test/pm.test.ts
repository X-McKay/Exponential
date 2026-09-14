import { describe, expect, test } from "bun:test";
import { routes } from "@valueflow/shared";
import type { PMAssignment, PMRun } from "@valueflow/shared";
import { createApp } from "../src/app.ts";
import { openDb } from "../src/db.ts";
import { seed } from "../src/seed.ts";
import type { ChatMessage, Llm } from "../src/llm.ts";
import { createAssignment, getAssignment, runAssignment, runDuePm } from "../src/pm.ts";

const NOW = new Date("2026-09-10T12:00:00Z");
const reply = JSON.stringify({ summary: "PM health reviewed", attention: true, body: "## Blocker\nRelease decision needed." });
const fake: Llm = {
  model: () => Promise.resolve("fake"),
  chat: async (_messages: ChatMessage[]) => ({ content: reply, model: "fake", usage: null, truncated: false }),
  describe: () => ({ baseUrl: "http://fake", model: "fake", models: ["fake"], judgeModel: null, prices: {} }),
};

const app = () => { const db = openDb(":memory:"); seed(db); return createApp(db, { now: () => NOW, llm: fake, autoJudge: false }); };
const call = async (a: ReturnType<typeof app>, method: string, path: string, body?: unknown) => a.handleApi(new Request(`http://x${path}`, { method, headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }));

describe("PM assignments", () => {
  test("creates, lists, and partially updates while preserving commitments", async () => {
    const a = app();
    const created = await call(a, "POST", routes.pmAssignments(), { projectId: "ima", objective: "Review health and blockers", owner: "AM", cadence: "manual", commitments: [{ title: "Confirm owner", owner: "AM", due: "2026-09-20" }] });
    expect(created?.status).toBe(201);
    const assignment = await created!.json() as PMAssignment;
    const before = assignment.commitments[0]!.createdAt;
    const updated = await call(a, "PUT", routes.pmAssignment(assignment.id), { owner: "PM" });
    expect(updated?.status).toBe(200);
    const after = await updated!.json() as PMAssignment;
    expect(after.objective).toBe("Review health and blockers");
    expect(after.commitments[0]!.createdAt).toBe(before);
    expect((await (await call(a, "GET", routes.pmAssignments()))!.json() as PMAssignment[]).length).toBe(1);
  });

  test("manual run persists PM output and links its underlying agent run", async () => {
    const a = app();
    const assignment = await (await call(a, "POST", routes.pmAssignments(), { projectId: "ima", objective: "Review blockers", owner: "AM", commitments: [{ title: "Decision", owner: "AM", due: null }] }))!.json() as PMAssignment;
    const run = await call(a, "POST", routes.pmRun(assignment.id), { instruction: "Include communications brief" });
    expect(run?.status).toBe(201);
    const body = await run!.json() as PMRun;
    expect(body.state).toBe("attention");
    expect(body.agentRunId).toBeTruthy();
    expect(body.output).toContain("Blocker");
    const runs = await (await call(a, "GET", routes.pmRuns(assignment.id)))!.json() as PMRun[];
    expect(runs[0]!.agentRunId).toBe(body.agentRunId);
  });

  test("onChange manual assignments run once and dedupe unchanged inputs", async () => {
    const a = app(); const x = await createAssignment(a.db, { projectId: "ima", objective: "Watch changes", owner: "AM", cadence: "manual", onChange: true, enabled: true, commitments: [] }, NOW);
    await runAssignment(a.db, fake, x.id, NOW, "manual");
    expect(await runDuePm(a.db, fake, new Date(NOW.getTime() + 8 * 86_400_000))).toEqual([]);
  });

  test("weekly assignments wait seven days before repeating unchanged work", async () => {
    const a = app(); const x = await createAssignment(a.db, { projectId: "ima", objective: "Weekly health", owner: "AM", cadence: "weekly", enabled: true, onChange: false, commitments: [] }, NOW);
    await runAssignment(a.db, fake, x.id, NOW, "manual");
    expect(await runDuePm(a.db, fake, new Date(NOW.getTime() + 6 * 86_400_000))).toEqual([]);
    expect((await runDuePm(a.db, fake, new Date(NOW.getTime() + 7 * 86_400_000))).length).toBe(1);
  });

  test("failed runs leave fingerprint unset and use a retry cooldown", async () => {
    const a = app(); const x = await createAssignment(a.db, { projectId: "ima", objective: "Failure test", owner: "AM", cadence: "weekly", enabled: true, onChange: false, commitments: [] }, NOW);
    const down: Llm = { ...fake, chat: async () => { throw new Error("offline"); } };
    const failed = await runAssignment(a.db, down, x.id, NOW, "manual");
    expect(failed.state).toBe("failed"); expect(getAssignment(a.db, x.id).lastInputFingerprint).toBeNull();
    expect(await runDuePm(a.db, down, new Date(NOW.getTime() + 30 * 60_000))).toEqual([]);
    expect((await runDuePm(a.db, down, new Date(NOW.getTime() + 61 * 60_000))).length).toBe(1);
  });

  test("concurrent PM calls are rejected while the agent run is working", async () => {
    const a = app(); const x = await createAssignment(a.db, { projectId: "ima", objective: "Concurrency", owner: "AM", cadence: "manual", enabled: true, onChange: true, commitments: [] }, NOW);
    let release!: () => void; const pending = new Promise<void>((resolve) => { release = resolve; });
    const slow: Llm = { ...fake, chat: async () => { await pending; return { content: reply, model: "fake", usage: null, truncated: false }; } };
    const first = runAssignment(a.db, slow, x.id, NOW, "manual");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(runAssignment(a.db, slow, x.id, NOW, "manual")).rejects.toThrow("already running");
    const live = (await import("../src/pm.ts")).listRuns(a.db, x.id)[0]; expect(live?.agentRunId).toBeTruthy();
    release(); await first;
  });

  test("commitment status updates preserve its creation time", async () => {
    const a = app(); const x = await createAssignment(a.db, { projectId: "ima", objective: "Commitments", owner: "AM", cadence: "manual", enabled: true, onChange: false, commitments: [{ id: "c1", title: "Decision", owner: "AM", due: null, status: "open" }] }, NOW);
    const created = x.commitments[0]!.createdAt;
    const next = new Date(NOW.getTime() + 86_400_000);
    const updated = await import("../src/pm.ts").then(({ updateAssignment }) => updateAssignment(a.db, x.id, { commitments: [{ id: "c1", title: "Decision", owner: "AM", due: null, status: "done" }] }, next));
    expect(updated.commitments[0]!.status).toBe("done"); expect(updated.commitments[0]!.createdAt).toBe(created);
  });

  test("disabled assignments never run in the background", async () => {
    const a = app(); await createAssignment(a.db, { projectId: "ima", objective: "Disabled", owner: "AM", cadence: "weekly", enabled: false, onChange: true, commitments: [] }, NOW);
    expect(await runDuePm(a.db, fake, new Date(NOW.getTime() + 30 * 86_400_000))).toEqual([]);
  });
});

test("changed development facts trigger a review, sync metadata alone does not", async () => {
  const a = app();
  const x = createAssignment(a.db, { projectId: "ima", objective: "Watch CI", owner: "AM", cadence: "manual", onChange: true, enabled: true, commitments: [] }, NOW);
  const { loadState, replaceDevFacts } = await import("../src/repo.ts");
  const facts = loadState(a.db, NOW).dev.ima!;
  await runAssignment(a.db, fake, x.id, NOW, "manual");
  const later = new Date(NOW.getTime() + 1000);
  const sync = { source: "test", startedAt: later.toISOString(), finishedAt: later.toISOString(), ok: true, message: "refreshed" };
  replaceDevFacts(a.db, "ima", facts, sync);
  expect(await runDuePm(a.db, fake, later)).toEqual([]);
  facts.repos[0]!.coverage = 42;
  replaceDevFacts(a.db, "ima", facts, sync);
  expect(await runDuePm(a.db, fake, later)).toHaveLength(1);
});

test("stale assignment edits are rejected and impossible due dates are invalid", async () => {
  const a = app();
  const x = createAssignment(a.db, { projectId: "ima", objective: "Track decisions", owner: "AM", cadence: "manual", onChange: false, enabled: true, commitments: [] }, NOW);
  expect((await call(a, "PUT", routes.pmAssignment(x.id), { expectedUpdatedAt: x.updatedAt, owner: "AL" }))?.status).toBe(200);
  expect((await call(a, "PUT", routes.pmAssignment(x.id), { expectedUpdatedAt: x.updatedAt, commitments: [] }))?.status).toBe(409);
  expect(getAssignment(a.db, x.id).owner).toBe("AL");
  expect((await call(a, "PUT", routes.pmAssignment(x.id), { commitments: [{ title: "Impossible", owner: "AL", due: "2026-02-30" }] }))?.status).toBe(400);
});

test("restart recovery preserves completed PM runs and releases interrupted assignments", async () => {
  const a = app();
  const x = createAssignment(a.db, { projectId: "ima", objective: "Recover", owner: "AM", cadence: "manual", onChange: false, enabled: true, commitments: [] }, NOW);
  const first = await runAssignment(a.db, fake, x.id, NOW, "manual");
  a.db.query("INSERT INTO pm_runs (id,assignment_id,project_id,trigger,input_fingerprint,state,summary,output,started_at) VALUES ('interrupted',?,'ima','manual','test','working','Running','',?)").run(x.id,NOW.toISOString());
  const { recoverInterruptedRuns } = await import("../src/recovery.ts");
  const { listRuns } = await import("../src/pm.ts");
  recoverInterruptedRuns(a.db,NOW);
  expect(listRuns(a.db,x.id).find(r => r.id === "interrupted")?.state).toBe("failed");
  expect(listRuns(a.db,x.id).find(r => r.id === first.id)?.state).toBe("attention");
  expect((await runAssignment(a.db,fake,x.id,NOW,"manual")).state).toBe("attention");
});

test("older workspaces install PM without replacing custom audit agents", async () => {
  const a = app(); a.db.query("DELETE FROM agents WHERE id='project-manager'").run();
  const { ensureAgents } = await import("../src/seed.ts");
  expect(ensureAgents(a.db)).toEqual(["project-manager"]);
  expect(ensureAgents(a.db)).toEqual([]);
  expect(a.db.query("SELECT id FROM agents WHERE id='audie'").get()).toBeTruthy();
});
