// Transparency while agents run: every step is a fact in run_events and a
// live event on the bus; the model's tokens stream through the same channel
// and are never stored; the SSE route relays the bus.

import { describe, expect, test } from "bun:test";
import { routes } from "@valueflow/shared";
import type { RunEvent } from "@valueflow/domain";
import { runAgent } from "../src/agents.ts";
import { createApp } from "../src/app.ts";
import { openDb } from "../src/db.ts";
import { judgeRun } from "../src/evals.ts";
import { liveBus, liveResponse } from "../src/live.ts";
import type { LiveEvent } from "../src/live.ts";
import { createLlm, readStream } from "../src/llm.ts";
import type { Llm } from "../src/llm.ts";
import { seed } from "../src/seed.ts";
import { BASE } from "./helpers.ts";

const NOW = new Date("2026-09-10T12:00:00Z");

const REPLY = JSON.stringify({ summary: "Recall 86% below the 88% gate", attention: true, body: "## Recall gap\nRule recall is 86% on MS-21.", proposals: [{ type: "governance_status", gid: "sla", status: "draft", rationale: "Described as started." }, { type: "governance_status", gid: "nope", status: "draft", rationale: "bad" }] });
const JUDGE = JSON.stringify({ groundedness: 9, completeness: 8, actionability: 7, clarity: 9, unsupported: [], expectations: [], critique: "Fine." });

/** A model that streams its reply in three pieces when asked to. */
const streaming = (): Llm => ({
  model: () => Promise.resolve("fake"),
  chat: (messages, options = {}) => {
    const reply = messages[0]?.content.includes("impartial evaluator") ? JUDGE : REPLY;
    if (options.onToken) for (const piece of [reply.slice(0, 20), reply.slice(20, 60), reply.slice(60)]) options.onToken(piece);
    return Promise.resolve({ content: reply, model: "fake", usage: { prompt: 500, completion: 120 }, truncated: false });
  },
  describe: () => ({ baseUrl: "http://fake", model: "fake", models: ["fake"], judgeModel: null }),
});

describe("run logs and the live channel", () => {
  test("a run records its steps as facts, streams tokens live, and announces start and finish", async () => {
    const db = openDb(":memory:");
    seed(db);
    const seen: LiveEvent[] = [];
    const off = liveBus.subscribe((e) => seen.push(e));
    const llm = streaming();
    const run = await runAgent(db, llm, { agentId: "audie", proj: "ima", instruction: "Audit" }, NOW);
    await judgeRun(db, llm, run.id, NOW);
    off();
    expect(seen[0]).toMatchObject({ kind: "started", run: { id: run.id, agentId: "audie", proj: "ima" } });
    const steps = seen.filter((e): e is Extract<LiveEvent, { kind: "step" }> => e.kind === "step").map((e) => e.event.step);
    expect(steps).toEqual(["briefing", "request", "reply", "parsed", "proposals", "scored", "done", "judge", "judged"]);
    const tokens = seen.filter((e): e is Extract<LiveEvent, { kind: "token" }> => e.kind === "token");
    expect(tokens.length).toBe(3);
    expect(tokens.map((t) => t.text).join("")).toBe(REPLY);
    expect(seen.find((e) => e.kind === "finished")).toEqual({ kind: "finished", runId: run.id, state: "attention" });
    const app = createApp(db, { now: () => NOW, llm, autoJudge: false });
    const res = await app.handleApi(new Request(BASE + routes.runEvents(run.id)));
    const events = (await res?.json()) as RunEvent[];
    expect(events.map((e) => [e.seq, e.step])).toEqual([[1, "briefing"], [2, "request"], [3, "reply"], [4, "parsed"], [5, "proposals"], [6, "scored"], [7, "done"], [8, "judge"], [9, "judged"]]);
    expect(events[4]?.detail).toContain("kept 1 of 2");
    expect(events[2]?.detail).toContain("120 tokens out, 500 in");
    expect(events[8]?.detail).toContain("overall 84%");
    // Tokens are never stored.
    expect(db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM run_events WHERE detail LIKE '%Recall gap%'").get()?.n).toBe(0);
  });

  test("the SSE route relays bus events as data frames", async () => {
    const res = liveResponse();
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const first = decoder.decode((await reader.read()).value);
    expect(first).toBe(": connected\n\n");
    liveBus.emit({ kind: "finished", runId: "run-9", state: "done" });
    const frame = decoder.decode((await reader.read()).value);
    expect(frame).toBe('data: {"kind":"finished","runId":"run-9","state":"done"}\n\n');
    await reader.cancel();
    expect(liveBus.size).toBe(0);
  });

  test("the LLM client folds an OpenAI-style token stream into one reply", async () => {
    const frames = [
      'data: {"model":"m1","choices":[{"delta":{"role":"assistant","content":""},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"delta":{"content":"{\\"a\\":"},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"delta":{"content":"1}"},"finish_reason":"stop"}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":3}}\n\n',
      "data: [DONE]\n\n",
    ];
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const f of frames) c.enqueue(new TextEncoder().encode(f));
        c.close();
      },
    });
    const pieces: string[] = [];
    const folded = await readStream(new Response(body), (t) => pieces.push(t));
    expect(pieces).toEqual(['{"a":', "1}"]);
    expect(folded).toEqual({ model: "m1", choices: [{ message: { content: '{"a":1}' }, finish_reason: "stop" }], usage: { prompt_tokens: 7, completion_tokens: 3 } });
    let sent: unknown = null;
    const llm = createLlm({
      baseUrl: "http://x/v1",
      model: "m1",
      fetch: (_url, init) => {
        sent = JSON.parse(String(init?.body));
        return Promise.resolve(new Response(new ReadableStream({ start: (c) => { for (const f of frames) c.enqueue(new TextEncoder().encode(f)); c.close(); } })));
      },
    });
    const r = await llm.chat([{ role: "user", content: "hi" }], { onToken: () => undefined });
    expect((sent as { stream: boolean }).stream).toBe(true);
    expect(r).toEqual({ content: '{"a":1}', model: "m1", usage: { prompt: 7, completion: 3 }, truncated: false });
  });
});
