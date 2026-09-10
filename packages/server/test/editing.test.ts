// Every fact that used to be seed-only is now writable: projects (details,
// team, repos), governance items, releases and their criteria, the workspace
// user, and the JSON documents mirrored from external systems.

import { describe, expect, test } from "bun:test";
import { AGENTS, DEV, FEED, UPCOMING, calendarOf, releaseState } from "@valueflow/domain";
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

describe("JSON documents", () => {
  test("PUT replaces dev activity, agents, feed, and calendar after validating the whole document", async () => {
    const app = testApp();
    const dev = structuredClone(DEV.onboarding!);
    dev.stats.coverage = 91;
    dev.prs = dev.prs.slice(0, 1);
    const putDev = await app.send<typeof dev>("PUT", routes.dev("onboarding"), dev);
    expect(putDev.status).toBe(200);
    expect(putDev.body).toEqual(dev);
    expect((await app.send("PUT", routes.dev("onboarding"), { ...dev, stats: { ...dev.stats, coverage: 250 } })).status).toBe(400);
    expect((await app.send("PUT", routes.dev("nope"), dev)).status).toBe(404);
    // A project without activity can gain some.
    expect((await app.send("PUT", routes.dev("sector"), dev)).status).toBe(200);

    const agents = AGENTS.slice(0, 2).map((a) => ({ ...a, runs: a.runs + 1 }));
    expect((await app.send("PUT", routes.agents(), agents)).status).toBe(200);
    expect((await app.send("PUT", routes.agents(), [{ ...agents[0]!, status: "asleep" }])).status).toBe(400);

    const feed = [FEED[0]!];
    expect((await app.send("PUT", routes.feed(), feed)).status).toBe(200);
    const upcoming = UPCOMING.slice(0, 1);
    expect((await app.send("PUT", routes.upcoming(), upcoming)).status).toBe(200);

    const state = await stateOf(app);
    expect(state.dev.onboarding).toEqual(dev);
    expect(state.dev.sector).toEqual(dev);
    expect(state.agents).toEqual(agents);
    expect(state.feed).toEqual(feed);
    expect(state.upcoming).toEqual(upcoming);
    expect((await app.get(routes.glance())).status).toBe(200);
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
