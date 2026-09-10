// Every fact that used to be seed-only is now writable: projects (details,
// team, repos), governance items, releases and their criteria, the workspace
// user, and the JSON documents mirrored from external systems.

import { describe, expect, test } from "bun:test";
import { AGENTS, calendarOf, releaseState } from "@valueflow/domain";
import type { AppState, GovernanceItem, Project, Release, Workspace } from "@valueflow/domain";
import { routes } from "@valueflow/shared";
import type { ProjectInput } from "@valueflow/shared";
import { testApp } from "./helpers.ts";

const stateOf = async (app: ReturnType<typeof testApp>) => (await app.get<AppState>(routes.state())).body;

const fresh: ProjectInput = {
  id: "kyc-refresh",
  key: "PRJ-11",
  name: "KYC refresh automation",
  stage: "Discovery",
  description: "Periodic KYC refresh with agentic document collection.",
  tier: 3,
  committee: null,
  repos: [{ name: "kyc-agent", url: "github.com/org/kyc-agent" }],
  team: [{ ini: "AM", name: "Al McKay", role: "Sponsor" }],
  targets: { fte: 20, time: 30 },
};

describe("projects", () => {
  test("POST creates with team and repos; duplicate id → 409; invalid id → 400", async () => {
    const app = testApp();
    const created = await app.send<Project>("POST", routes.projects(), fresh);
    expect(created.status).toBe(201);
    expect(created.body).toEqual({ ...fresh, milestones: [], governance: [] });
    expect((await app.send("POST", routes.projects(), fresh)).status).toBe(409);
    expect((await app.send("POST", routes.projects(), { ...fresh, id: "Not Valid" })).status).toBe(400);
    const state = await stateOf(app);
    expect(state.projects.map((p) => p.id)).toEqual(["onboarding", "ima", "sector", "kyc-refresh"]);
    expect(state.releases["kyc-refresh"]).toEqual([]);
  });

  test("PUT replaces details, team, and repos but leaves milestones and governance alone", async () => {
    const app = testApp();
    const before = (await stateOf(app)).projects.find((p) => p.id === "ima")!;
    const input: ProjectInput = {
      id: "ima",
      key: before.key,
      name: "IMA rule extraction",
      stage: "Scaling",
      description: before.description,
      tier: 2,
      committee: { date: "2026-09-01", ref: "AIRC-2026-060" },
      repos: [{ name: "ima-rule-extractor", url: "github.com/org/ima-rule-extractor" }],
      team: [
        { ini: "SC", name: "S. Chen", role: "Compliance SME" },
        { ini: "ZQ", name: "Z. Quinn", role: "New engineer" },
      ],
      targets: { fte: 30, time: 50 },
    };
    const { status, body } = await app.send<Project>("PUT", routes.project("ima"), input);
    expect(status).toBe(200);
    expect(body.name).toBe("IMA rule extraction");
    expect(body.tier).toBe(2);
    expect(body.committee).toEqual({ date: "2026-09-01", ref: "AIRC-2026-060" });
    expect(body.repos).toEqual(input.repos);
    expect(body.team).toEqual(input.team);
    expect(body.milestones).toEqual(before.milestones);
    expect(body.governance).toEqual(before.governance);
    expect((await app.send("PUT", routes.project("ima"), { ...input, id: "other" })).status).toBe(400);
    expect((await app.send("PUT", routes.project("nope"), { ...input, id: "nope" })).status).toBe(404);
  });

  test("DELETE removes the project and everything under it", async () => {
    const app = testApp();
    expect((await app.send("DELETE", routes.project("onboarding"))).status).toBe(200);
    expect((await app.send("DELETE", routes.project("onboarding"))).status).toBe(404);
    const state = await stateOf(app);
    expect(state.projects.map((p) => p.id)).toEqual(["ima", "sector"]);
    expect(state.releases.onboarding).toBeUndefined();
    expect(state.dev.onboarding).toBeUndefined();
    for (const table of ["milestones", "metrics", "metric_readings", "governance_items", "releases", "release_criteria", "team_members", "project_repos"]) {
      const n = app.db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM ${table} WHERE project_id = 'onboarding'`).get()?.n;
      expect(n).toBe(0);
    }
    expect((await app.get(routes.glance())).status).toBe(200);
  });
});

describe("governance items", () => {
  test("POST adds an item in a new category; PUT can rename and recategorise; DELETE leaves release criteria pointing at it", async () => {
    const app = testApp();
    const item = { id: "vendor", cat: "Third parties", name: "Vendor risk assessment", status: "draft", owner: "JL", date: null, detail: "" };
    const created = await app.send<GovernanceItem>("POST", routes.governanceItems("ima"), item);
    expect(created.status).toBe(201);
    expect(created.body).toEqual({ id: "vendor", cat: "Third parties", name: "Vendor risk assessment", status: "draft", owner: "JL", date: null, detail: "" });
    expect((await app.send("POST", routes.governanceItems("ima"), item)).status).toBe(409);
    expect((await app.send("POST", routes.governanceItems("nope"), item)).status).toBe(404);

    const renamed = await app.send<GovernanceItem>("PUT", routes.governance("ima", "vendor"), { ...item, cat: "Operations", name: "Vendor risk review", status: "approved" });
    expect(renamed.body).toMatchObject({ cat: "Operations", name: "Vendor risk review", status: "approved" });

    expect((await app.send("DELETE", routes.governance("ima", "sec"))).status).toBe(200);
    expect((await app.send("DELETE", routes.governance("ima", "sec"))).status).toBe(404);
    const state = await stateOf(app);
    const ima = state.projects.find((p) => p.id === "ima")!;
    expect(ima.governance.some((g) => g.id === "sec")).toBe(false);
    const r1 = state.releases.ima![0]!;
    expect(r1.criteria[1]).toEqual({ type: "gov", gid: "sec", label: "Security review & pen test approved" });
    expect(releaseState(r1, ima, calendarOf(state)).evals[1]).toMatchObject({ ok: false, sub: "not tracked" });
  });
});

describe("releases", () => {
  test("POST/PUT/DELETE manage a release and its criteria; state is derived live", async () => {
    const app = testApp();
    const rel: Release = {
      id: "R4",
      name: "Entity resolution GA",
      month: "2027-02",
      milestoneIds: ["MS-16"],
      criteria: [
        { type: "gate", ms: "MS-16", label: "Entity resolution base gate" },
        { type: "gov", gid: "card", label: "System card approved" },
        { type: "manual", ok: false, label: "Comms plan agreed" },
      ],
    };
    const created = await app.send<Release>("POST", routes.releases("onboarding"), rel);
    expect(created.status).toBe(201);
    expect(created.body).toEqual(rel);
    expect((await app.send("POST", routes.releases("onboarding"), rel)).status).toBe(409);

    const state = await stateOf(app);
    const p = state.projects[0]!;
    expect(releaseState(rel, p, calendarOf(state))).toMatchObject({ met: 0, total: 3, label: "At risk" });

    const updated = await app.send<Release>("PUT", routes.release("onboarding", "R4"), { ...rel, criteria: [{ type: "manual", ok: true, label: "Comms plan agreed" }] });
    expect(updated.status).toBe(200);
    expect(updated.body.criteria).toEqual([{ type: "manual", ok: true, label: "Comms plan agreed" }]);
    expect(releaseState(updated.body, p, calendarOf(state)).label).toBe("Ready");
    expect((await app.send("PUT", routes.release("onboarding", "R4"), { ...rel, id: "R9" })).status).toBe(400);
    expect((await app.send("PUT", routes.release("onboarding", "R9"), { ...rel, id: "R9" })).status).toBe(404);

    expect((await app.send("DELETE", routes.release("onboarding", "R4"))).status).toBe(200);
    expect((await stateOf(app)).releases.onboarding!.map((r) => r.id)).toEqual(["R1", "R2", "R3"]);
    expect((await app.send("DELETE", routes.release("onboarding", "R4"))).status).toBe(404);
  });
});

describe("workspace", () => {
  test("PUT changes the signed-in user shown everywhere", async () => {
    const app = testApp();
    expect((await stateOf(app)).workspace).toEqual({ user: { name: "Al McKay", ini: "AM" } });
    const { status, body } = await app.send<Workspace>("PUT", routes.workspace(), { user: { name: "Priya Nair", ini: "PN" } });
    expect(status).toBe(200);
    expect(body).toEqual({ user: { name: "Priya Nair", ini: "PN" } });
    expect((await stateOf(app)).workspace.user.name).toBe("Priya Nair");
    expect((await app.send("PUT", routes.workspace(), { user: { name: "", ini: "TOOLONG" } })).status).toBe(400);
  });
});

describe("sync", () => {
  test("POST sync replaces a project's development facts from the configured source", async () => {
    const app = testApp();
    const before = (await stateOf(app)).dev.onboarding!;
    expect(before.lastSync).toMatchObject({ source: "sample", ok: true });
    expect(before.prs.length).toBe(8);
    expect(before.commits.length).toBeGreaterThan(50);

    const { status, body } = await app.send<{ run: { ok: boolean; source: string; message: string }; facts: typeof before }>("POST", routes.sync("onboarding"));
    expect(status).toBe(200);
    expect(body.run).toMatchObject({ ok: true, source: "sample" });
    expect(body.run.message).toContain("3 repos");
    expect(body.facts.prs.map((p) => p.number)).toEqual(before.prs.map((p) => p.number));
    expect(body.facts.repos.map((r) => r.repo)).toEqual(["doc-ingest-pipeline", "onboarding-evals", "onboarding-mapping-svc"]);
    expect((await app.send("POST", routes.sync("nope"))).status).toBe(404);

    // A project with repos but no sample gets generated commit history only.
    await app.send("POST", routes.projects(), { ...fresh, id: "kyc" });
    const synced = await app.send<{ run: { ok: boolean }; facts: typeof before }>("POST", routes.sync("kyc"));
    expect(synced.status).toBe(200);
    expect(synced.body.facts.repos).toEqual([{ repo: "kyc-agent", branch: "main", lang: null, coverage: null, quality: null, measuredAt: "2026-09-10T09:00:00.000Z" }]);
    expect(synced.body.facts.prs).toEqual([]);
    expect(synced.body.facts.commits.length).toBeGreaterThan(0);

    const status2 = await app.get<{ source: string; projects: Record<string, { source: string } | null> }>(routes.syncStatus());
    expect(status2.body.source).toBe("sample");
    expect(status2.body.projects.kyc?.source).toBe("sample");
  });

  test("a failing source keeps the previous facts and records the failure", async () => {
    const app = testApp();
    const { syncProject } = await import("../src/sync.ts");
    const project = (await stateOf(app)).projects[0]!;
    const run = await syncProject(app.db, { name: "broken", fetchRepo: () => Promise.reject(new Error("rate limited")) }, project, new Date("2026-09-10T10:00:00Z"));
    expect(run).toMatchObject({ ok: false, source: "broken", message: "rate limited" });
    const after = (await stateOf(app)).dev.onboarding!;
    expect(after.prs.length).toBe(8);
    expect(after.lastSync).toMatchObject({ ok: false, source: "broken" });
  });

  test("PUT replaces the agents document after validating it", async () => {
    const app = testApp();
    const agents = AGENTS.slice(0, 2).map((a) => ({ ...a, purpose: a.purpose + " (edited)" }));
    expect((await app.send("PUT", routes.agents(), agents)).status).toBe(200);
    expect((await app.send("PUT", routes.agents(), [{ ...agents[0]!, kind: "asleep" }])).status).toBe(400);
    expect((await stateOf(app)).agents).toEqual(agents);
  });
});

describe("events", () => {
  test("the seed carries the sample log plus what a sync of the sample facts implies, and re-syncing adds nothing", async () => {
    const app = testApp();
    const before = (await stateOf(app)).events;
    expect(before.length).toBeGreaterThan(10);
    expect(before.map((e) => e.ref)).toContain("build:doc-ingest-pipeline/#1148");
    expect(before.map((e) => e.ref)).toContain("pr:onboarding-mapping-svc#408:merged");
    for (let i = 1; i < before.length; i++) expect(before[i - 1]!.at >= before[i]!.at).toBe(true);
    await app.send("POST", routes.sync("onboarding"));
    expect((await stateOf(app)).events.length).toBe(before.length);
  });

  test("governance moves, eval readings, and milestone status changes append events; manual readings do not", async () => {
    const app = testApp();
    const n = (await stateOf(app)).events.length;
    await app.send("PUT", routes.governance("ima", "sla"), { status: "draft", owner: "JL", date: null, detail: "" });
    await app.send("PUT", routes.governance("ima", "sla"), { status: "draft", owner: "AM", date: null, detail: "owner only" });
    await app.send("PUT", routes.readings("ima", "MS-21", "rec"), { value: 84, source: "eval" });
    await app.send("PUT", routes.readings("ima", "MS-21", "rec"), { value: 90 });
    const ms = (await stateOf(app)).projects.find((p) => p.id === "ima")!.milestones.find((m) => m.id === "MS-22")!;
    await app.send("PUT", routes.milestone("ima", "MS-22"), { ...ms, status: "shipped" });
    const events = (await stateOf(app)).events;
    expect(events.length).toBe(n + 3);
    const texts = events.slice(0, 3).map((e) => `${e.type}: ${e.text}`);
    expect(texts).toContain("gov: Product SLA moved to Draft");
    expect(texts).toContain("eval: Eval: Restriction clause extraction · Rule recall at 84% — 4pts below base gate (88%)");
    expect(texts).toContain("ship: Universe definition parser shipped — gated impact now counts toward realized value");
    const glance = (await app.get<{ blocks: { kind: string; items?: { text: string }[] }[] }>(routes.glance())).body;
    const activity = glance.blocks.find((b) => b.kind === "activity");
    expect(activity?.items?.[0]?.text).toContain("Product SLA moved to Draft");
  });
});

describe("calendar", () => {
  test("POST/PUT/DELETE manage dated events; upcoming merges them with release targets", async () => {
    const app = testApp();
    const ev = { id: "board-readout", date: "2026-09-12", proj: "onboarding", tab: "value", text: "Board readout", sub: "Q3 value review" };
    const created = await app.send<typeof ev>("POST", routes.calendar(), ev);
    expect(created.status).toBe(201);
    expect(created.body).toEqual(ev);
    expect((await app.send("POST", routes.calendar(), ev)).status).toBe(409);
    expect((await app.send("POST", routes.calendar(), { ...ev, id: "x", proj: "nope" })).status).toBe(404);
    expect((await app.send("POST", routes.calendar(), { ...ev, id: "y", date: "12/09/2026" })).status).toBe(400);

    const glance = (await app.get<{ blocks: { kind: string; items?: { date: string; text: string; release?: unknown }[] }[]; narrative: string[] }>(routes.glance())).body;
    const up = glance.blocks.find((b) => b.kind === "upcoming")!.items!;
    expect(up[0]).toMatchObject({ date: "Sep 12", text: "Board readout" });
    expect(up[1]).toMatchObject({ date: "Sep 14", text: "Pen test window opens" });
    expect(up.some((u) => u.release !== undefined && u.text === "R1 · Shadow mode target")).toBe(true);
    expect(glance.narrative.at(-1)).toBe("Next on the calendar: Sep 12 — board readout (Client onboarding efficie…).");

    const moved = await app.send<typeof ev>("PUT", routes.calendarEvent("board-readout"), { ...ev, date: "2026-10-02" });
    expect(moved.body.date).toBe("2026-10-02");
    expect((await app.send("PUT", routes.calendarEvent("board-readout"), { ...ev, id: "other" })).status).toBe(400);
    expect((await app.send("DELETE", routes.calendarEvent("board-readout"))).status).toBe(200);
    expect((await app.send("DELETE", routes.calendarEvent("board-readout"))).status).toBe(404);
    expect((await stateOf(app)).calendar.map((c) => c.id)).toEqual(["pen-test-window", "recall-gate-review", "airc-oct-submission", "quarterly-rereview"]);
  });
});

describe("derived values are still never stored", () => {
  test("the new tables hold facts only", () => {
    const app = testApp();
    const sql = app.db
      .query<{ sql: string }, []>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'workspace'")
      .get()
      ?.sql.toLowerCase();
    expect(sql).toContain("user_name");
    for (const banned of ["realized", "readiness", "release_state", "gate_tier"]) expect(sql?.includes(banned)).toBe(false);
  });
});
