// Agents run against a model and store runs as facts. A fake LLM stands in
// for the real endpoint; the real one is exercised manually (LLM_BASE_URL).

import { describe, expect, test } from "bun:test";
import { agentStats, attentionRuns, isDue, seedState } from "@valueflow/domain";
import type { AgentRun, AppState } from "@valueflow/domain";
import { routes } from "@valueflow/shared";
import { buildMessages, projectContext, runAgent } from "../src/agents.ts";
import { runDue } from "../src/runner.ts";
import { createApp } from "../src/app.ts";
import { sampleSource } from "../src/connectors/index.ts";
import { openDb } from "../src/db.ts";
import type { ChatMessage, Llm } from "../src/llm.ts";
import { createLlm, extractJson } from "../src/llm.ts";
import { SEED_NOW, seed } from "../src/seed.ts";
import { testApp } from "./helpers.ts";

const fakeLlm = (reply: (messages: ChatMessage[]) => string | Error): Llm => ({
  model: () => Promise.resolve("fake-model"),
  chat: (messages) => {
    const r = reply(messages);
    return r instanceof Error ? Promise.reject(r) : Promise.resolve({ content: r, model: "fake-model", usage: { prompt: 10, completion: 5 }, truncated: false });
  },
  describe: () => ({ baseUrl: "http://fake", model: "fake-model", models: ["fake-model"], judgeModel: null }),
});

const NOW = new Date("2026-09-10T12:00:00Z");

describe("derived agent state", () => {
  test("status, counts, success, and attention derive from runs", () => {
    const st = seedState();
    const audie = st.agents.find((a) => a.id === "audie")!;
    const comma = st.agents.find((a) => a.id === "comma")!;
    expect(agentStats(audie, st.runs, st.asOf)).toMatchObject({ status: "scheduled", runs: 4, success: 100, attention: 1 });
    expect(agentStats(comma, st.runs, st.asOf).status).toBe("working");
    expect(attentionRuns(st.runs, st.asOf).map((r) => r.summary)).toEqual(["Rule activations in ima-rule-extractor lack immutable audit log — Tier 1 exposure"]);
    expect(isDue(audie, st.runs, st.asOf)).toBe(false);
    expect(isDue(audie, st.runs, "2026-09-11T12:00:00Z")).toBe(true);
    expect(isDue(comma, st.runs, "2026-09-11T12:00:00Z")).toBe(false);
  });
});

describe("briefing", () => {
  test("the context is facts only and the messages carry the instruction", () => {
    const st = seedState();
    const ima = st.projects.find((p) => p.id === "ima")!;
    const { calendarOf } = require("@valueflow/domain") as typeof import("@valueflow/domain");
    const ctx = projectContext(st, ima, calendarOf(st));
    expect(ctx).toContain("# IMA compliance rule extraction (PRJ-7)");
    expect(ctx).toContain("Rule recall: 86% (base ≥88, stretch ≥96) → below");
    expect(ctx).toContain("R1 Shadow mode — target Oct, Blocked, 1/4 criteria met");
    expect(ctx).toContain("FAILED build #400");
    const msgs = buildMessages(st.agents[3]!, st, ima, calendarOf(st), "Focus on audit trails");
    expect(msgs[0]?.role).toBe("system");
    expect(msgs[0]?.content).toContain("You are Audie");
    expect(msgs[1]?.content).toStartWith("Instruction: Focus on audit trails");
  });
});

describe("runAgent", () => {
  test("stores a working run, then the parsed result; attention comes from the reply", async () => {
    const db = openDb(":memory:");
    seed(db);
    const llm = fakeLlm(() => JSON.stringify({ summary: "Two audit-trail gaps found", attention: true, body: "## Finding 1\n- evidence" }));
    const run = await runAgent(db, llm, { agentId: "audie", proj: "ima", instruction: "audit trails" }, NOW);
    expect(run).toMatchObject({ agentId: "audie", proj: "ima", tab: "governance", state: "attention", summary: "Two audit-trail gaps found", output: "## Finding 1\n- evidence", model: "fake-model", instruction: "audit trails" });
    expect(run.id).toBe("run-14");
    const app = createApp(db, { now: () => NOW, llm });
    const state = (await (await app.handleApi(new Request("http://x/api/state")))!.json()) as AppState;
    expect(state.runs[0]).toEqual(run);
    expect(state.llm).toEqual({ baseUrl: "http://fake", model: "fake-model", models: ["fake-model"], judgeModel: null });
  });

  test("a reply wrapped in prose still parses; an unusable reply or a failing model records a failed run", async () => {
    expect(extractJson('Sure! ```json\n{"a":1}\n```')).toEqual({ a: 1 });
    const db = openDb(":memory:");
    seed(db);
    const wrapped = await runAgent(db, fakeLlm(() => 'Here you go: {"summary":"Deck ready","attention":false,"body":"## Slide 1"} thanks'), { agentId: "slider", proj: "onboarding" }, NOW);
    expect(wrapped).toMatchObject({ state: "done", summary: "Deck ready", tab: "value" });
    const junk = await runAgent(db, fakeLlm(() => "I cannot help with that."), { agentId: "slider", proj: "onboarding" }, NOW);
    expect(junk.state).toBe("failed");
    expect(junk.error).toContain("JSON");
    const down = await runAgent(db, fakeLlm(() => new Error("LLM 503: overloaded")), { agentId: "comma", proj: "sector" }, NOW);
    expect(down).toMatchObject({ state: "failed", error: "LLM 503: overloaded" });
    await expect(runAgent(db, fakeLlm(() => "{}"), { agentId: "nobody", proj: "sector" }, NOW)).rejects.toThrow("agent nobody not found");
  });

  test("the API route runs an agent and refuses without a model", async () => {
    const withLlm = (() => {
      const db = openDb(":memory:");
      seed(db);
      return createApp(db, { now: () => NOW, source: sampleSource(), llm: fakeLlm(() => JSON.stringify({ summary: "Options ranked", attention: false, body: "1. **A**" })) });
    })();
    const res = await withLlm.handleApi(new Request("http://x" + routes.agentRuns("nova"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ proj: "sector", tab: "value" }) }));
    expect(res?.status).toBe(201);
    const run = (await res!.json()) as AgentRun;
    expect(run).toMatchObject({ agentId: "nova", proj: "sector", state: "done", summary: "Options ranked" });

    const without = testApp();
    const refused = await without.send("POST", routes.agentRuns("nova"), { proj: "sector" });
    expect(refused.status).toBe(409);
    expect((await withLlm.handleApi(new Request("http://x" + routes.agentRuns("nova"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ proj: "nope" }) })))?.status).toBe(404);
  });

  test("scheduled agents run once per project when due, then are not due", async () => {
    const db = openDb(":memory:");
    seed(db);
    const llm = fakeLlm(() => JSON.stringify({ summary: "Nightly scan clean", attention: false, body: "No findings." }));
    const later = new Date(SEED_NOW.getTime() + 30 * 3_600_000);
    const first = await runDue(db, llm, later);
    // Nightly: Audie and Sentry per project. Weekly, never run: Monday once, Coach once per agent with enough measured runs; Scout skips with a single model.
    expect(first.map((r) => `${r.agentId}/${r.proj ?? "workspace"}`)).toEqual(["audie/onboarding", "audie/ima", "audie/sector", "sentry/onboarding", "sentry/ima", "sentry/sector", "monday/workspace", "coach/workspace", "coach/workspace", "coach/workspace", "curator/workspace"]);
    expect(first.filter((r) => r.agentId === "coach").map((r) => r.instruction)).toEqual(["Tune Slider", "Tune Nova", "Tune Audie"]);
    expect(await runDue(db, llm, later)).toEqual([]);
  });
});

describe("llm client", () => {
  test("resolves the model from /models, disables thinking, and sends a JSON schema", async () => {
    const calls: { url: string; body?: unknown }[] = [];
    const llm = createLlm({
      baseUrl: "http://llm.test/v1/",
      apiKey: "k",
      fetch: (url, init) => {
        calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        if (url.endsWith("/models")) return Promise.resolve(Response.json({ data: [{ id: "m1" }] }));
        return Promise.resolve(Response.json({ model: "m1", choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 3, completion_tokens: 2 } }));
      },
    });
    const r = await llm.chat([{ role: "user", content: "hi" }], { jsonSchema: { name: "t", schema: { type: "object" } } });
    expect(r).toEqual({ content: '{"ok":true}', model: "m1", usage: { prompt: 3, completion: 2 }, truncated: false });
    expect(calls[0]?.url).toBe("http://llm.test/v1/models");
    const body = calls[1]?.body as Record<string, unknown>;
    expect(body.model).toBe("m1");
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect((body.response_format as { type: string }).type).toBe("json_schema");
    expect(llm.describe()).toEqual({ baseUrl: "http://llm.test/v1", model: "m1", models: ["m1"], judgeModel: null });
  });
});
