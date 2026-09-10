import { describe, expect, test } from "bun:test";
import { PROJECTS, realized, seedState, tierOf } from "@valueflow/domain";
import type { AppState, GovernanceItem, Metric, MetricReading, Milestone } from "@valueflow/domain";
import { routes } from "@valueflow/shared";
import { READINGS_PER_METRIC, trajectory } from "../src/seed.ts";
import { testApp } from "./helpers.ts";

describe("seed", () => {
  test("GET /api/state round-trips the fixtures exactly", async () => {
    const app = testApp();
    const { status, body } = await app.get<AppState>(routes.state());
    expect(status).toBe(200);
    expect(body).toEqual(seedState());
  });

  test("seeds ~30 readings per measurable metric, ending at the mockup's current value", async () => {
    const app = testApp();
    const { body } = await app.get<MetricReading[]>(routes.readings("onboarding", "MS-12", "acc"));
    expect(body.length).toBe(READINGS_PER_METRIC);
    expect(body.at(-1)?.value).toBe(87);
    expect(body.every((r) => r.source === "eval")).toBe(true);
    for (let i = 1; i < body.length; i++) expect(body[i]!.recordedAt >= body[i - 1]!.recordedAt).toBe(true);
    const unmeasured = await app.get<MetricReading[]>(routes.readings("onboarding", "MS-14", "rec"));
    expect(unmeasured.body).toEqual([]);
  });

  test("trajectory is deterministic, bounded, and lands on current", () => {
    const a = trajectory({ current: 81 }, 42);
    expect(a).toEqual(trajectory({ current: 81 }, 42));
    expect(a.at(-1)).toBe(81);
    expect(a.every((v) => v >= 2 && v <= 99)).toBe(true);
    expect(a[0]!).toBeLessThan(70);
  });
});

describe("routing", () => {
  test("unknown API path → 404, wrong method → 405, non-API path → null", async () => {
    const app = testApp();
    expect((await app.get("/api/nope")).status).toBe(404);
    expect((await app.send("DELETE", routes.state())).status).toBe(405);
    expect(await app.handleApi(new Request("http://valueflow.test/"))).toBeNull();
  });
  test("invalid JSON and schema failures → 400 with issues", async () => {
    const app = testApp();
    const bad = await app.handleApi(new Request("http://valueflow.test" + routes.targets("onboarding"), { method: "PUT", body: "{" }));
    expect(bad?.status).toBe(400);
    const { status, body } = await app.send<{ error: string; issues: unknown[] }>("PUT", routes.targets("onboarding"), { fte: 500, time: -1 });
    expect(status).toBe(400);
    expect(body.error).toBe("validation failed");
    expect(body.issues.length).toBe(2);
  });
});

describe("readings", () => {
  test("PUT appends a reading and the metric's current follows the latest", async () => {
    const app = testApp();
    const { status, body } = await app.send<{ reading: MetricReading; metric: Metric }>("PUT", routes.readings("onboarding", "MS-13", "ext"), { value: 90 });
    expect(status).toBe(201);
    expect(body.reading.source).toBe("manual");
    expect(body.metric.current).toBe(90);
    const list = await app.get<MetricReading[]>(routes.readings("onboarding", "MS-13", "ext"));
    expect(list.body.length).toBe(READINGS_PER_METRIC + 1);
  });
  test("unknown metric → 404", async () => {
    const app = testApp();
    expect((await app.send("PUT", routes.readings("onboarding", "MS-13", "nope"), { value: 1 })).status).toBe(404);
    expect((await app.get(routes.readings("onboarding", "MS-99", "ext"))).status).toBe(404);
  });
});

describe("milestones", () => {
  const base = PROJECTS[0]!.milestones.find((m) => m.id === "MS-13")!;

  test("PUT updates definition; changing current appends a manual reading; unchanged current does not", async () => {
    const app = testApp();
    const input: Milestone = { ...base, name: "Document ingestion pipeline v2", metrics: base.metrics.map((x) => ({ ...x })) };
    const first = await app.send<Milestone>("PUT", routes.milestone("onboarding", "MS-13"), input);
    expect(first.status).toBe(200);
    expect(first.body.name).toBe("Document ingestion pipeline v2");
    expect((await app.get<MetricReading[]>(routes.readings("onboarding", "MS-13", "ext"))).body.length).toBe(READINGS_PER_METRIC);

    input.metrics[0]!.current = 95;
    const second = await app.send<Milestone>("PUT", routes.milestone("onboarding", "MS-13"), input);
    expect(second.body.metrics[0]!.current).toBe(95);
    const readings = (await app.get<MetricReading[]>(routes.readings("onboarding", "MS-13", "ext"))).body;
    expect(readings.length).toBe(READINGS_PER_METRIC + 1);
    expect(readings.at(-1)).toMatchObject({ value: 95, source: "manual" });
  });

  test("PUT removes dropped metrics and adds new ones", async () => {
    const app = testApp();
    const input: Milestone = { ...base, metrics: [{ id: "new", label: "New criterion", base: 50, stretch: 80, current: 0 }] };
    const { body } = await app.send<Milestone>("PUT", routes.milestone("onboarding", "MS-13"), input);
    expect(body.metrics.map((x) => x.id)).toEqual(["new"]);
    expect((await app.get(routes.readings("onboarding", "MS-13", "ext"))).status).toBe(404);
  });

  test("POST creates; duplicate id → 409; body/URL id mismatch → 400", async () => {
    const app = testApp();
    const fresh: Milestone = {
      id: "MS-17",
      name: "Reviewer assist",
      status: "backlog",
      month: 12,
      impact: { base: { fte: 3, time: 3 }, stretch: { fte: 5, time: 5 } },
      metrics: [],
    };
    const created = await app.send<Milestone>("POST", routes.milestones("onboarding"), fresh);
    expect(created.status).toBe(201);
    expect(created.body).toEqual(fresh);
    expect((await app.send("POST", routes.milestones("onboarding"), fresh)).status).toBe(409);
    expect((await app.send("PUT", routes.milestone("onboarding", "MS-99"), fresh)).status).toBe(400);
    expect((await app.send("PUT", routes.milestone("onboarding", "MS-99"), { ...fresh, id: "MS-99" })).status).toBe(404);
    const state = (await app.get<AppState>(routes.state())).body;
    expect(state.projects[0]!.milestones.map((m) => m.id)).toEqual(["MS-12", "MS-15", "MS-13", "MS-14", "MS-16", "MS-17"]);
  });

  test("DELETE removes the milestone and its readings; release criteria referencing it resolve to not-met", async () => {
    const app = testApp();
    expect((await app.send("DELETE", routes.milestone("onboarding", "MS-12"))).status).toBe(200);
    expect((await app.send("DELETE", routes.milestone("onboarding", "MS-12"))).status).toBe(404);
    const state = (await app.get<AppState>(routes.state())).body;
    const p = state.projects[0]!;
    expect(p.milestones.some((m) => m.id === "MS-12")).toBe(false);
    expect(realized(p, "fte")).toBe(5);
    expect(state.releases.onboarding![0]!.criteria[0]).toEqual({ type: "gate", ms: "MS-12", label: "Mapping base gate (accuracy ≥80, coverage ≥80)" });
    const glance = (await app.get<{ blocks: { kind: string; title: string }[] }>(routes.glance())).body;
    expect(glance.blocks.length).toBeGreaterThan(0);
    const rows = app.db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM metric_readings WHERE milestone_id = 'MS-12'").get();
    expect(rows?.n).toBe(0);
  });
});

describe("targets & governance", () => {
  test("PUT targets rescales the project; unknown project → 404", async () => {
    const app = testApp();
    const { status, body } = await app.send<{ fte: number; time: number }>("PUT", routes.targets("ima"), { fte: 35, time: 55 });
    expect(status).toBe(200);
    expect(body).toEqual({ fte: 35, time: 55 });
    expect((await app.send("PUT", routes.targets("nope"), { fte: 1, time: 1 })).status).toBe(404);
  });

  test("PUT governance updates status/owner/date/detail/link and clears link when omitted", async () => {
    const app = testApp();
    const { status, body } = await app.send<GovernanceItem>("PUT", routes.governance("ima", "sla"), {
      status: "draft",
      owner: "JL",
      date: "2026-09-12",
      detail: "Drafted with compliance ops.",
      link: "confluence/ima-sla",
    });
    expect(status).toBe(200);
    expect(body).toEqual({ cat: "Operations", id: "sla", name: "Product SLA", status: "draft", owner: "JL", date: "2026-09-12", detail: "Drafted with compliance ops.", link: "confluence/ima-sla" });
    const cleared = await app.send<GovernanceItem>("PUT", routes.governance("ima", "sla"), { status: "approved", owner: "JL", date: null, detail: "" });
    expect(cleared.body.link).toBeUndefined();
    expect((await app.send("PUT", routes.governance("ima", "nope"), { status: "approved", owner: "JL", date: null, detail: "" })).status).toBe(404);
    expect((await app.send("PUT", routes.governance("ima", "sla"), { status: "approved", owner: "JL", date: "12/09/2026", detail: "" })).status).toBe(400);
  });
});

describe("derived values are never stored", () => {
  test("no table carries realized value, tiers, readiness, or release state", () => {
    const app = testApp();
    const cols = app.db
      .query<{ name: string; sql: string }, []>("SELECT name, sql FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => r.sql.toLowerCase());
    for (const sql of cols) {
      for (const banned of ["realized", "tier_cleared", "readiness", "release_state", "gate_tier", "glance"]) expect(sql.includes(banned)).toBe(false);
    }
    const p = seedState().projects[0]!;
    expect(tierOf(p.milestones[0]!)).toBe(1);
  });
});
