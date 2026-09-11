import { useEffect, useState } from "react";
import { STEP_LABEL } from "@valueflow/domain";
import type { RunEvent } from "@valueflow/domain";
import { api } from "../api/client.ts";
import { Markdown } from "../editors/RunAgent.tsx";
import { partialField } from "../state/live.ts";
import { Caret, reset } from "./primitives.tsx";
import { C } from "../theme.ts";

/** Re-render every `ms` while `on`, for elapsed-time counters. */
export const useTicker = (on: boolean, ms = 1000): number => {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setTick((v) => v + 1), ms);
    return () => clearInterval(t);
  }, [on, ms]);
  return tick;
};

export const elapsed = (fromIso: string, toIso?: string | null): string => {
  const s = Math.max(0, (toIso ? new Date(toIso).getTime() : Date.now()) - new Date(fromIso).getTime()) / 1000;
  return s < 60 ? `${s.toFixed(s < 10 ? 1 : 0)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
};

const secsBetween = (a: string, b: string): string => `${((new Date(b).getTime() - new Date(a).getTime()) / 1000).toFixed(1)}s`;

function Spinner({ color = C.indigoHi }: { color?: string }) {
  return (
    <svg className="vf-spin" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" style={{ display: "block" }}>
      <path d="M6 1.5a4.5 4.5 0 1 1-4.5 4.5" />
    </svg>
  );
}

/**
 * Every step a run took, in order, with how long each took. While the run is
 * working the last step carries a spinner; afterwards the list is the log.
 */
export function StepTimeline({ steps, startedAt, working }: { steps: RunEvent[]; startedAt: string; working: boolean }) {
  useTicker(working);
  const tone = (s: RunEvent) => (s.step === "failed" ? C.red : s.step === "done" || s.step === "judged" ? C.green : s.step === "retry" ? C.amber : C.mut);
  const rows = steps.map((s, i) => ({ s, took: i === 0 ? secsBetween(startedAt, s.at) : secsBetween(steps[i - 1]?.at ?? startedAt, s.at) }));
  return (
    <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 2 }}>
      {rows.map(({ s, took }, i) => {
        const last = i === rows.length - 1;
        const active = working && last && s.step !== "done" && s.step !== "failed";
        return (
          <li key={s.seq} className="vf-step" style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "4px 0", fontSize: 12.5 }}>
            <span style={{ width: 12, height: 18, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              {active ? <Spinner /> : <span style={{ width: 6, height: 6, borderRadius: "50%", background: tone(s), display: "block" }} />}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ color: active ? C.text : C.text2 }}>{STEP_LABEL[s.step]}</span>
              {s.detail && <span style={{ color: C.dim }}> · {s.detail}</span>}
            </span>
            <span style={{ fontSize: 11, color: C.dim, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>+{took}</span>
          </li>
        );
      })}
      {working && rows.length === 0 && (
        <li style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12.5, color: C.text2 }}>
          <Spinner /> Starting…
        </li>
      )}
    </ol>
  );
}

/** The model's reply as it streams: the prose field read out of the partial JSON, else a character count. */
export function LiveOutput({ text, field }: { text: string; field: string }) {
  const prose = partialField(text, field);
  return (
    <div style={{ position: "relative" }}>
      {prose ? (
        <div className="vf-stream">
          <Markdown text={prose} />
          <span className="vf-caret" aria-hidden />
        </div>
      ) : (
        <div style={{ fontSize: 12, color: C.dim }}>{text.length ? `${text.length.toLocaleString()} characters so far, structured fields first…` : "Waiting for the first token…"}</div>
      )}
    </div>
  );
}

/** A finished run's log, fetched when opened. */
export function RunLog({ runId, startedAt, live }: { runId: string; startedAt: string; live?: RunEvent[] | undefined }) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<RunEvent[] | null>(live ?? null);
  useEffect(() => {
    if (open && events === null) api.runEvents(runId).then(setEvents).catch(() => setEvents([]));
  }, [open, events, runId]);
  return (
    <div style={{ marginTop: 12 }}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="vf-row" style={{ ...reset, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: C.dim, padding: "4px 8px", borderRadius: 6 }}>
        <Caret open={open} /> Run log{events ? ` · ${events.length} step${events.length === 1 ? "" : "s"}` : ""}
      </button>
      {open && (
        <div style={{ background: C.inset, border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 12px", marginTop: 6 }}>
          {events === null ? <div style={{ fontSize: 12, color: C.dim }}>Loading…</div> : events.length === 0 ? <div style={{ fontSize: 12, color: C.dim }}>No log for this run; it predates run logs.</div> : <StepTimeline steps={events} startedAt={startedAt} working={false} />}
        </div>
      )}
    </div>
  );
}
