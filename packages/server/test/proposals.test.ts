// Agents propose; people decide. Accepting applies the change through the
// same repository functions the editors use.

import { describe, expect, test } from "bun:test";
import type { AppState, Proposal } from "@valueflow/domain";
import { routes } from "@valueflow/shared";
import { runAgent } from "../src/agents.ts";
import { createApp } from "../src/app.ts";
import { openDb } from "../src/db.ts";
import type { Llm } from "../src/llm.ts";
import { seed } from "../src/seed.ts";
import type { TestApp } from "./helpers.ts";
import { BASE } from "./helpers.ts";

const NOW = new Date("2026-09-10T12:00:00Z");

const reply = JSON.stringify({
  summary: "Governance drift found",
  attention: true,
  body: "## Findings",
  proposals: [
    { type: "governance_status", gid: "sla", status: "draft", rationale: "SLA work has started per the runbook draft." },
    { type: "calendar_event", date: "2026-09-18", text: "SLA workshop with compliance ops", sub: null, tab: "governance", rationale: "Needed before pilot exit." },
    { type: "governance_item", cat: "Operations", name: "Immutable audit log for rule activations", status: "missing", owner: "RS", detail: "Tier 1 exposure.", rationale: "No audit log exists." },
    { type: "milestone_status", mid: "MS-99", status: "shipped", rationale: "does not exist" },
    { type: "governance_status", gid: "sla", status: "sideways", rationale: "bad status" },
    { type: "targets", fte: 35, time: 55, rationale: "Committee pre-read used these." },
  ],
});

const fake: Llm = {
  model: () => Promise.resolve("fake"),
  chat: () => Promise.resolve({ content: reply, model: "fake", usage: null, truncated: false }),
  describe: () => ({ baseUrl: "http://fake", model: "fake", models: ["fake"], judgeModel: null, prices: {} }),
};

const appWith = (): TestApp => {
  const db = openDb(":memory:");
  seed(db);
  const app = createApp(db, { now: () => NOW, llm: fake });
  const call = async <T>(method: string, path: string, body?: unknown) => {
    const res = await app.handleApi(new Request(BASE + path, { method, headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }));
    if (!res) throw new Error("not an api route");
    return { status: res.status, body: (await res.json()) as T };
  };
  return { ...app, get: (path) => call("GET", path), send: (method, path, body) => call(method, path, body) };
};

describe("proposals", () => {
  test("a run stores the valid proposals it made and drops the rest", async () => {
    const app = appWith();
    const run = await runAgent(app.db, fake, { agentId: "audie", proj: "ima" }, NOW);
    const state = (await app.get<AppState>(routes.state())).body;
    const mine = state.proposals.filter((p) => p.runId === run.id);
    expect(mine.map((p) => p.action.type)).toEqual(["governance_status", "calendar_event", "governance_item", "targets"]);
    expect(mine.every((p) => p.state === "pending" && p.agentId === "audie" && p.proj === "ima")).toBe(true);
    expect(mine[0]?.rationale).toBe("SLA work has started per the runbook draft.");
    expect(mine.map((p) => p.id)).toEqual(["prop-1", "prop-2", "prop-3", "prop-4"]);
  });

  test("accepting applies each kind of change and appends events; dismissing does not; deciding twice is refused", async () => {
    const app = appWith();
    await runAgent(app.db, fake, { agentId: "audie", proj: "ima" }, NOW);
    const before = (await app.get<AppState>(routes.state())).body;
    const ids = before.proposals.map((p) => p.id);

    const a1 = await app.send<Proposal>("POST", routes.proposalAccept(ids[0]!));
    expect(a1.status).toBe(200);
    expect(a1.body.state).toBe("accepted");
    const a2 = await app.send<Proposal>("POST", routes.proposalAccept(ids[1]!));
    const a3 = await app.send<Proposal>("POST", routes.proposalAccept(ids[2]!));
    const d4 = await app.send<Proposal>("POST", routes.proposalDismiss(ids[3]!));
    expect([a2.status, a3.status, d4.status]).toEqual([200, 200, 200]);
    expect(d4.body.state).toBe("dismissed");

    const after = (await app.get<AppState>(routes.state())).body;
    const ima = after.projects.find((p) => p.id === "ima")!;
    expect(ima.governance.find((g) => g.id === "sla")?.status).toBe("draft");
    expect(ima.governance.some((g) => g.id === "immutable-audit-log-for-rule-activations" && g.status === "missing" && g.owner === "RS")).toBe(true);
    expect(after.calendar.some((c) => c.id === "sla-workshop-with-compliance-ops" && c.date === "2026-09-18" && c.proj === "ima")).toBe(true);
    expect(ima.targets).toEqual({ fte: 30, time: 50 });
    expect(after.events[0]?.text).toBe("Product SLA moved to Draft");
    expect(after.proposals.map((p) => p.state)).toEqual(["accepted", "accepted", "accepted", "dismissed"]);

    expect((await app.send("POST", routes.proposalAccept(ids[0]!))).status).toBe(409);
    expect((await app.send("POST", routes.proposalDismiss(ids[3]!))).status).toBe(409);
    expect((await app.send("POST", routes.proposalAccept("prop-99"))).status).toBe(404);
  });

  test("a proposal whose target was deleted is refused, not applied", async () => {
    const app = appWith();
    await runAgent(app.db, fake, { agentId: "audie", proj: "ima" }, NOW);
    await app.send("DELETE", routes.governance("ima", "sla"));
    const res = await app.send<{ error: string }>("POST", routes.proposalAccept("prop-1"));
    expect(res.status).toBe(409);
    expect(res.body.error).toContain("no longer exists");
    expect((await app.get<AppState>(routes.state())).body.proposals.find((p) => p.id === "prop-1")?.state).toBe("pending");
  });
});
