import { describe, expect, test } from "bun:test";
import { openDb } from "../src/db.ts";
import { seed } from "../src/seed.ts";
import type { ChatMessage, Llm } from "../src/llm.ts";
import { approveArtifact, createAssignment, getDetail, listArtifacts, runAssignment } from "../src/comms.ts";

const NOW = new Date("2026-09-10T12:00:00Z");
const reply = JSON.stringify({ summary: "Draft ready", attention: false, body: "## Update\nA clear draft.", proposals: [] });
const fake: Llm = { model: () => Promise.resolve("fake"), chat: async (_m: ChatMessage[]) => ({ content: reply, model: "fake", usage: null, truncated: false }), describe: () => ({ baseUrl: "http://fake", model: "fake", models: ["fake"], judgeModel: null, prices: {} }) };
const db = () => { const d = openDb(":memory:"); seed(d); return d; };

describe("communications assignments", () => {
  test("persists conversation, run, and draft artifact versions", async () => {
    const d = db(); const a = createAssignment(d, { projectId: "ima", objective: "Keep leaders informed", audience: "Executives", format: "executive_update", owner: "AM", enabled: true, onChange: false, cadence: "manual" }, NOW);
    const first = await runAssignment(d, fake, a.id, NOW, "manual", "Mention the release gate");
    expect(first.agentRunId).toBeTruthy(); expect(getDetail(d, a.id).messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(listArtifacts(d, "ima")[0]?.version).toBe(1);
    await runAssignment(d, fake, a.id, new Date(NOW.getTime() + 1000), "manual");
    expect(listArtifacts(d, "ima").map((x) => x.version)).toEqual([2, 1]);
  });
  test("approval is explicit and immutable across new versions", async () => {
    const d = db(); const a = createAssignment(d, { projectId: "ima", objective: "Memo", audience: "Team", format: "decision_memo", owner: "AM", enabled: true, onChange: false, cadence: "manual" }, NOW);
    await runAssignment(d, fake, a.id, NOW, "manual"); const one = listArtifacts(d)[0]!; expect(approveArtifact(d, one.id, "approved", NOW).status).toBe("approved");
    await runAssignment(d, fake, a.id, new Date(NOW.getTime() + 1000), "manual"); expect(listArtifacts(d).find((x) => x.id === one.id)?.status).toBe("approved");
  });
  test("failed runs do not create assistant messages or artifacts", async () => {
    const d = db(); const a = createAssignment(d, { projectId: "ima", objective: "Failure", audience: "Team", format: "project_brief", owner: "AM", enabled: true, onChange: false, cadence: "manual" }, NOW); const down: Llm = { ...fake, chat: async () => { throw new Error("offline"); } };
    const r = await runAssignment(d, down, a.id, NOW, "manual", "Try"); expect(r.state).toBe("failed"); expect(getDetail(d, a.id).messages.map((m) => m.role)).toEqual(["user"]); expect(listArtifacts(d)).toHaveLength(0);
  });
  test("stale updates are rejected and custom communications agent is used", async () => {
    const d = db(); const a = createAssignment(d, { projectId: "ima", objective: "Update", audience: "Team", format: "release_notes", owner: "AM", enabled: true, onChange: false, cadence: "manual" }, NOW); const { updateAssignment } = await import("../src/comms.ts");
    const next = updateAssignment(d, a.id, { expectedUpdatedAt: a.updatedAt, owner: "JL" }, NOW); expect(next.owner).toBe("JL"); expect(() => updateAssignment(d, a.id, { expectedUpdatedAt: a.updatedAt, owner: "AM" }, NOW)).toThrow();
    d.query("DELETE FROM agents WHERE id='comma'").run(); d.query("INSERT INTO agents (id,sort,name,grad,purpose,kind,model,owner,caps,schedule) VALUES ('custom-comma',99,'Custom Comma','x','Writes communications','comms',NULL,'AM','[]',NULL)").run(); const r = await runAssignment(d, fake, a.id, new Date(NOW.getTime() + 1000), "manual"); expect(r.state).toBe("done"); expect(d.query<{ agent_id: string }, []>("SELECT agent_id FROM agent_runs ORDER BY rowid DESC LIMIT 1").get()?.agent_id).toBe("custom-comma");
  });
});
