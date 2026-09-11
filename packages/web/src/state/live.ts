// ================= live run events (client) =================
//
// A server-sent-events subscription that tells the store what every run is
// doing while it runs: the step it is on, the model's output as it streams,
// and when it finishes. Reconnects on its own; nothing here is stored.

import type { AgentRun, RunEvent } from "@valueflow/domain";
import { routes } from "@valueflow/shared";

export interface LiveRun {
  id: string;
  agentId: string;
  proj: string | null;
  startedAt: string;
  instruction: string | null;
  benchmark: string | null;
  steps: RunEvent[];
  /** The model's raw output so far (JSON while it streams). */
  text: string;
  state: AgentRun["state"];
}

export type LiveMessage =
  | { kind: "started"; run: Pick<AgentRun, "id" | "agentId" | "proj" | "startedAt" | "instruction" | "benchmark"> }
  | { kind: "step"; event: RunEvent }
  | { kind: "token"; runId: string; text: string }
  | { kind: "finished"; runId: string; state: AgentRun["state"] };

/** Apply one message to the live map; returns the same map when nothing changed. */
export const applyLive = (live: Record<string, LiveRun>, m: LiveMessage): Record<string, LiveRun> => {
  switch (m.kind) {
    case "started":
      return { ...live, [m.run.id]: { ...m.run, steps: [], text: "", state: "working" } };
    case "step": {
      const cur = live[m.event.runId];
      if (!cur) return live;
      return { ...live, [m.event.runId]: { ...cur, steps: [...cur.steps, m.event] } };
    }
    case "token": {
      const cur = live[m.runId];
      if (!cur) return live;
      return { ...live, [m.runId]: { ...cur, text: cur.text + m.text } };
    }
    case "finished": {
      const cur = live[m.runId];
      if (!cur) return live;
      return { ...live, [m.runId]: { ...cur, state: m.state } };
    }
  }
};

/** Open the channel; `onMessage` receives every event. Returns a closer. */
export const subscribeLive = (onMessage: (m: LiveMessage) => void, onOpen?: () => void): (() => void) => {
  let source: EventSource | null = null;
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | null = null;
  const open = () => {
    if (closed) return;
    source = new EventSource(routes.live());
    source.addEventListener("open", () => onOpen?.());
    source.addEventListener("message", (e: MessageEvent<string>) => {
      try {
        onMessage(JSON.parse(e.data) as LiveMessage);
      } catch {
        /* a malformed frame is not worth breaking the channel */
      }
    });
    source.addEventListener("error", () => {
      source?.close();
      source = null;
      if (!closed) retry = setTimeout(open, 3000);
    });
  };
  open();
  return () => {
    closed = true;
    if (retry) clearTimeout(retry);
    source?.close();
  };
};

/**
 * The value of one string field from JSON that is still being written, so a
 * streaming reply can be read as prose before it is complete. Handles the
 * common escapes; stops at the closing quote when it has arrived.
 */
export const partialField = (json: string, key: string): string | null => {
  const m = new RegExp(`"${key}"\\s*:\\s*"`).exec(json);
  if (!m) return null;
  let out = "";
  for (let i = m.index + m[0].length; i < json.length; i++) {
    const ch = json[i];
    if (ch === "\\") {
      const next = json[i + 1];
      if (next === undefined) break;
      out += next === "n" ? "\n" : next === "t" ? "\t" : next === "u" ? "" : next;
      i += next === "u" ? 5 : 1;
      continue;
    }
    if (ch === '"') break;
    out += ch;
  }
  return out;
};
