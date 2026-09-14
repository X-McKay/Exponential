import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.ts";
import { initializeWorkspace } from "../src/seed.ts";
import { createApp } from "../src/app.ts";
import { createSettings } from "../src/settings.ts";
import { sourceFromEnv } from "../src/connectors/index.ts";
import { loadState } from "../src/repo.ts";
import { actorContext, createMember } from "../src/identity.ts";
import { normalizeDraft } from "../src/setup.ts";
import type { AppState } from "@valueflow/domain";

describe("shared workspace release", () => {
  test("initializing an existing empty workspace preserves its customized profile", () => {
    const db = openDb(":memory:");
    db.query("UPDATE workspace SET user_name='Existing Person',user_ini='EP' WHERE id=1").run();
    initializeWorkspace(db);
    expect(loadState(db).workspace.user.name).toBe("Existing Person");
    expect(loadState(db).projects).toEqual([]);
    expect(loadState(db).agents.every(a => a.owner === "EP")).toBe(true);
    db.close();
  });

  test("inferred committee approval never becomes a populated approval suggestion", () => {
    const draft = normalizeDraft({ committee: { value: { date: "2026-09-30", ref: "PRJ-1" }, confidence: "low", source: "", rationale: "Inferred from a charter" } }, "2026-09");
    expect(draft.committee.value).toBeNull();
  });

  test("saving the default connection preserves environment prices, candidates and judge", () => {
    const dir = mkdtempSync(join(tmpdir(), "valueflow-provider-env-"));
    try {
      const settings = createSettings(join(dir, "llm.settings.json"), {
        LLM_BASE_URL: "https://primary.example/v1", LLM_MODEL: "original",
        LLM_MODELS: "alternate@https://secondary.example/v1", EVAL_JUDGE_MODEL: "judge",
        LLM_PRICES: "test=1/2", LLM_PROVIDER_SECOND_BASE_URL: "https://secondary.example/v1", LLM_PROVIDER_SECOND_API_KEY: "secondary-key",
      });
      settings.save({ enabled: true, baseUrl: "https://primary.example/v1", model: "test", thinking: false, revision: 0 });
      const info = settings.getLlm()!.describe();
      expect(info.models).toContain("alternate@https://secondary.example/v1");
      expect(info.judgeModel).toBe("judge");
      expect(info.prices.test).toEqual({ input: 1, output: 2 });
      expect(() => settings.getLlm()!.validateModel!("alternate@https://secondary.example/v1")).not.toThrow();
    } finally { rmSync(dir, { recursive: true }); }
  });

  test("empty initialization is durable across restart and deletion of the last project", () => {
    const dir = mkdtempSync(join(tmpdir(), "valueflow-init-"));
    try {
      const file = join(dir, "workspace.sqlite");
      let db = openDb(file);
      initializeWorkspace(db);
      expect(loadState(db).projects).toEqual([]);
      expect(loadState(db).agents.some(a => a.id === "project-manager")).toBe(true);
      expect(loadState(db).runs).toEqual([]);
      expect(loadState(db).workspace.user.name).toBe("Workspace owner");
      db.query("INSERT INTO projects (id,key,name,stage,description,target_fte,target_time,sort) VALUES ('test','TEST','Test','Pilot','',0,0,0)").run();
      db.query("DELETE FROM projects").run();
      db.close(); db = openDb(file); initializeWorkspace(db);
      expect(loadState(db).projects).toEqual([]);
      expect(db.query<{ n: number }, []>("SELECT COUNT(*) n FROM workspace_members").get()?.n).toBe(1);
      expect(sourceFromEnv({})).toBeNull();
      db.close();
    } finally { rmSync(dir, { recursive: true }); }
  });

  test("user selection stays request-local, viewer writes fail, and mutations are attributed", async () => {
    const db = openDb(":memory:"); initializeWorkspace(db);
    const alex = createMember(db, "Alex Rivera", "editor");
    const sam = createMember(db, "Sam Lee", "viewer");
    const app = createApp(db);
    const request = (id: string, role: string, path: string, method = "GET", body?: unknown) => app.handleApi(new Request(`http://valueflow.test/api/${path}`, {
      method, headers: { "x-valueflow-user": id, "x-valueflow-role": role, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }));
    const [a, b] = await Promise.all([request(alex.id, "editor", "state"), request(sam.id, "viewer", "state")]);
    expect((await a!.json()).workspace.user.name).toBe(alex.name);
    expect((await b!.json()).workspace.user.name).toBe(sam.name);
    expect((await request(sam.id, "viewer", "workspace", "PUT", { user: { name: "Changed", ini: "ZZ" } }))!.status).toBe(403);
    expect((await request(alex.id, "editor", "workspace", "PUT", { user: { name: "Alex Updated", ini: "ZZ" } }))!.status).toBe(200);
    expect((await (await request(alex.id, "editor", "state"))!.json()).workspace.user).toEqual({ name: "Alex Updated", ini: alex.ini });
    expect((await (await request(sam.id, "viewer", "state"))!.json()).workspace.user.name).toBe(sam.name);
    expect(db.query<{ member_id: string }, []>("SELECT member_id FROM mutation_audit").get()?.member_id).toBe(alex.id);
    await request(alex.id, "editor", "glance/seen", "POST");
    expect((await (await request(sam.id, "viewer", "state"))!.json()).workspace.lastGlanceAt).toBeNull();
    const values = await Promise.all([alex, sam].map(actor => actorContext.run(actor, async () => { await Promise.resolve(); return loadState(db).workspace.user.ini; })));
    expect(values).toEqual([alex.ini, sam.ini]);
    db.close();
  });

  test("a stale browser revision cannot overwrite a newer workspace edit", async () => {
    const db = openDb(":memory:"); initializeWorkspace(db);
    const app = createApp(db);
    const initial = await app.handleApi(new Request("http://valueflow.test/api/state"));
    const revision = initial!.headers.get("x-valueflow-revision");
    expect(revision).toBe("0");
    const edit = (name: string) => app.handleApi(new Request("http://valueflow.test/api/workspace", {
      method: "PUT", headers: { "content-type": "application/json", "x-valueflow-revision": revision! },
      body: JSON.stringify({ user: { name, ini: "WO" } }),
    }));
    expect((await edit("First editor"))!.status).toBe(200);
    const stale = await edit("Stale editor");
    expect(stale!.status).toBe(409);
    expect(stale!.headers.get("x-valueflow-revision")).toBe("1");
    const current = await app.handleApi(new Request("http://valueflow.test/api/state"));
    expect((await current!.json() as AppState).workspace.user.name).toBe("First editor");
    db.close();
  });

  test("same-revision writes are atomic and rejected input does not consume a revision", async () => {
    const db = openDb(":memory:"); initializeWorkspace(db);
    const app = createApp(db);
    const edit = (name: string, body = JSON.stringify({ user: { name, ini: "WO" } })) => app.handleApi(new Request("http://valueflow.test/api/workspace", {
      method: "PUT", headers: { "content-type": "application/json", "x-valueflow-revision": "0" }, body,
    }));

    const invalid = await edit("ignored", "{");
    expect(invalid!.status).toBe(400);
    expect(invalid!.headers.get("x-valueflow-revision")).toBe("0");

    const writes = await Promise.all([edit("First concurrent editor"), edit("Second concurrent editor")]);
    expect(writes.map((response) => response!.status).sort()).toEqual([200, 409]);
    const current = await app.handleApi(new Request("http://valueflow.test/api/state"));
    expect(["First concurrent editor", "Second concurrent editor"]).toContain((await current!.json() as AppState).workspace.user.name);
    expect(current!.headers.get("x-valueflow-revision")).toBe("1");
    db.close();
  });

  test("LLM settings redact and persist tokens, reject stale updates, and do not move keys between hosts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "valueflow-settings-"));
    const file = join(dir, "llm.settings.json");
    const db = openDb(":memory:"); initializeWorkspace(db);
    try {
      const settings = createSettings(file);
      const input = { enabled: true, baseUrl: "http://localhost:9991/v1", model: "test", thinking: false, revision: 0, apiKey: "test-private-key" };
      const app = createApp(db, { settings });
      const response = await app.handleApi(new Request("http://valueflow.test/api/settings/llm", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }));
      expect(response!.status).toBe(200);
      expect(await response!.text()).not.toContain(input.apiKey);
      const state = await app.handleApi(new Request("http://valueflow.test/api/state"));
      expect(await state!.text()).not.toContain(input.apiKey);
      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(createSettings(file).status().hasToken).toBe(true);
      const first = settings.getLlm();
      expect(() => settings.save(input)).toThrow("Settings changed");
      settings.save({ ...input, apiKey: undefined, baseUrl: "http://localhost:9992/v1", revision: 1 });
      expect(settings.status().hasToken).toBe(false);
      expect(readFileSync(file, "utf8")).not.toContain(input.apiKey);
      expect(first?.describe().baseUrl).toBe(input.baseUrl);
      expect(settings.getLlm()?.describe().baseUrl).toBe("http://localhost:9992/v1");
      settings.save({ ...input, enabled: false, apiKey: "", revision: 2 });
      expect(settings.getLlm()).toBeNull();
      const disabled = await app.handleApi(new Request("http://valueflow.test/api/state"));
      expect((await disabled!.json()).llm).toBeNull();
    } finally { db.close(); rmSync(dir, { recursive: true }); }
  });
});
