// ================= live run events =================
//
// What an agent is doing, while it does it. Every step a run takes is
// recorded as a fact (run_events) and pushed to anyone listening on the
// server-sent-events channel; the model's tokens are pushed as they arrive
// but never stored. One process-wide bus: the server is a single process.

import type { Database } from "bun:sqlite";
import type { AgentRun, RunEvent, RunStep } from "@valueflow/domain";
import { insertRunEvent } from "./repo.ts";

export type LiveEvent =
  | { kind: "started"; run: Pick<AgentRun, "id" | "agentId" | "proj" | "startedAt" | "instruction" | "benchmark"> }
  | { kind: "step"; event: RunEvent }
  | { kind: "token"; runId: string; text: string }
  | { kind: "finished"; runId: string; state: AgentRun["state"] };

type Listener = (e: LiveEvent) => void;

const listeners = new Set<Listener>();

export const liveBus = {
  emit(e: LiveEvent): void {
    for (const l of listeners) {
      try {
        l(e);
      } catch {
        /* a broken listener must not break a run */
      }
    }
  },
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get size(): number {
    return listeners.size;
  },
};

export interface Trace {
  /** Record a step as a fact and push it live. */
  step: (step: RunStep, detail?: string) => void;
  /** Push a streamed token; not stored. */
  token: (text: string) => void;
  finished: (state: AgentRun["state"]) => void;
}

/** A run's tracer: call `step` at each stage; the log and the live channel follow. */
export const trace = (db: Database, run: AgentRun): Trace => {
  liveBus.emit({ kind: "started", run: { id: run.id, agentId: run.agentId, proj: run.proj, startedAt: run.startedAt, instruction: run.instruction, benchmark: run.benchmark } });
  return {
    step: (step, detail = "") => {
      const event = insertRunEvent(db, run.id, step, detail.slice(0, 400), new Date().toISOString());
      liveBus.emit({ kind: "step", event });
    },
    token: (text) => liveBus.emit({ kind: "token", runId: run.id, text }),
    finished: (state) => liveBus.emit({ kind: "finished", runId: run.id, state }),
  };
};

/** Steps for a run that already exists (the judge grades after the fact); no "started" is announced. */
export const traceExisting = (db: Database, runId: string): Pick<Trace, "step"> => ({
  step: (step, detail = "") => {
    const event = insertRunEvent(db, runId, step, detail.slice(0, 400), new Date().toISOString());
    liveBus.emit({ kind: "step", event });
  },
});

const secs = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

/** "1.2k tokens in 8.4s"; what a reply step reads as. */
export const replyDetail = (usage: { prompt: number; completion: number } | null, ms: number, truncated: boolean): string =>
  `${usage ? `${usage.completion} tokens out, ${usage.prompt} in` : "reply"} in ${secs(ms)}${truncated ? " · cut off at the token budget" : ""}`;

/** A server-sent-events response that relays the bus until the client goes away. */
export const liveResponse = (): Response => {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let ping: ReturnType<typeof setInterval> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (e: LiveEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          unsubscribe?.();
        }
      };
      controller.enqueue(encoder.encode(": connected\n\n"));
      unsubscribe = liveBus.subscribe(send);
      ping = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          unsubscribe?.();
          if (ping) clearInterval(ping);
        }
      }, 15_000);
    },
    cancel() {
      unsubscribe?.();
      if (ping) clearInterval(ping);
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" } });
};
