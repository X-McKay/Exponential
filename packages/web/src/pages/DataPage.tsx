import { useState } from "react";
import { dateLabel, relTime } from "@valueflow/domain";
import type { Agent, AppState, CalendarEvent, Workspace } from "@valueflow/domain";
import { AgentsInputSchema } from "@valueflow/shared";
import { CalendarEditor } from "../editors/CalendarEditor.tsx";
import { JsonDocEditor } from "../editors/JsonDocEditor.tsx";
import { WorkspaceEditor } from "../editors/WorkspaceEditor.tsx";
import { Avatar, SectionCard, ghostBtn } from "../ui/primitives.tsx";
import { C } from "../theme.ts";

type Editing = { kind: "workspace" } | { kind: "agents" } | { kind: "calendar"; event: CalendarEvent | null } | null;

function Row({ title, sub, action, onClick, disabled }: { title: string; sub: string; action: string; onClick: () => void | Promise<void>; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderTop: `1px solid ${C.line}` }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13, color: C.text, display: "block" }}>{title}</span>
        <span style={{ fontSize: 12, color: C.dim }}>{sub}</span>
      </span>
      <button
        type="button"
        className="vf-ghost"
        disabled={busy || disabled}
        onClick={() => {
          const r = onClick();
          if (r instanceof Promise) {
            setBusy(true);
            void r.finally(() => setBusy(false));
          }
        }}
        style={{ ...ghostBtn, opacity: busy || disabled ? 0.5 : 1 }}
      >
        {busy ? "Working…" : action}
      </button>
    </div>
  );
}

const count = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/**
 * Everything that is not a project fact: the signed-in user and the JSON
 * documents mirrored from external systems (agents, feed, calendar,
 * development activity). Each document is validated against the same schema
 * the server enforces before it can be saved.
 */
export function DataPage({
  state,
  onWorkspace,
  onAgents,
  onCalendar,
  onDeleteCalendar,
  onSync,
}: {
  state: AppState;
  onWorkspace: (w: Workspace) => void;
  onAgents: (a: Agent[]) => void;
  onCalendar: (ev: CalendarEvent, isNew: boolean) => void;
  onDeleteCalendar: (id: string) => void;
  onSync: (pid: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState<Editing>(null);
  const close = () => setEditing(null);
  const projectIds = state.projects.map((p) => p.id).join(", ");
  const refHelp = `Project ids in use: ${projectIds}. Tabs: overview, value, roadmap, development, governance.`;
  const today = state.asOf.slice(0, 10);
  const projectName = (pid: string): string => state.projects.find((p) => p.id === pid)?.name ?? pid;
  const newest = state.events[0];

  return (
    <div style={{ padding: "16px 20px 30px", maxWidth: 860 }}>
      <div style={{ fontSize: 13, color: C.mut, lineHeight: 1.6, marginBottom: 14 }}>
        Projects, milestones, governance items, and releases are edited on their own pages. This page covers the rest: who you are, the calendar, the agents
        document, and what is synced from source control. The activity feed is not edited at all: it is derived from an event log that syncs, eval runs,
        milestone changes, and governance changes append to.
      </div>

      <SectionCard title="Workspace" pad="4px 14px 4px">
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0" }}>
          <Avatar ini={state.workspace.user.ini} size={26} />
          <span style={{ flex: 1 }}>
            <span style={{ fontSize: 13, color: C.text, display: "block" }}>{state.workspace.user.name}</span>
            <span style={{ fontSize: 12, color: C.dim }}>Signed-in user · greeted on Glance · default owner for new items</span>
          </span>
          <button type="button" className="vf-ghost" onClick={() => setEditing({ kind: "workspace" })} style={ghostBtn}>
            Edit
          </button>
        </div>
      </SectionCard>

      <SectionCard title="Workspace documents" pad="0 14px 4px">
        <Row title="Agents" sub={`${count(state.agents.length, "agent")} · shown on the Agents page and in Glance attention flags`} action="Edit JSON" onClick={() => setEditing({ kind: "agents" })} />
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderTop: `1px solid ${C.line}` }}>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 13, color: C.text, display: "block" }}>Activity feed</span>
            <span style={{ fontSize: 12, color: C.dim }}>
              {count(state.events.length, "event")} in the last 60 days · derived, append-only
              {newest ? ` · newest ${relTime(newest.at, state.asOf)}` : ""}
            </span>
          </span>
        </div>
      </SectionCard>

      <SectionCard
        title="Calendar"
        pad="0 14px 4px"
        right={
          <button type="button" className="vf-ghost" onClick={() => setEditing({ kind: "calendar", event: null })} style={{ ...ghostBtn, height: 24, color: C.indigoHi }}>
            + Add event
          </button>
        }
      >
        {state.calendar.length === 0 && <div style={{ fontSize: 12, color: C.dim, padding: "12px 0" }}>No dated events. Release targets still appear on Glance automatically.</div>}
        {state.calendar.map((c) => (
          <Row
            key={c.id}
            title={`${dateLabel(c.date)} · ${c.text}`}
            sub={`${projectName(c.proj)} → ${c.tab}${c.sub ? ` · ${c.sub}` : ""}${c.date < today ? " · past" : ""}`}
            action="Edit"
            onClick={() => setEditing({ kind: "calendar", event: c })}
          />
        ))}
      </SectionCard>

      <SectionCard
        title="Development activity"
        pad="0 14px 4px"
        right={<span style={{ fontSize: 12, color: C.dim }}>{state.syncSource ? `source: ${state.syncSource}` : "syncing is off (SYNC_SOURCE=none)"}</span>}
      >
        {state.projects.length === 0 && <div style={{ fontSize: 12, color: C.dim, padding: "12px 0" }}>No projects yet.</div>}
        {state.projects.map((p) => {
          const d = state.dev[p.id];
          const run = d?.lastSync ?? null;
          const summary = d ? `${count(d.repos.length, "repo")}, ${count(d.prs.length, "PR")}, ${count(d.builds.length, "build")}, ${count(d.commits.reduce((a, c) => a + c.count, 0), "commit")}` : "nothing synced yet";
          const when = run ? `${run.ok ? "synced" : "sync failed"} ${relTime(run.finishedAt, state.asOf)} via ${run.source}${run.ok ? "" : " — " + run.message}` : "never synced";
          return <Row key={p.id} title={p.name} sub={`${summary} · ${when}`} action="Sync now" disabled={!state.syncSource || p.repos.length === 0} onClick={() => onSync(p.id)} />;
        })}
      </SectionCard>

      {editing?.kind === "workspace" && (
        <WorkspaceEditor
          workspace={state.workspace}
          onSave={(w) => {
            onWorkspace(w);
            close();
          }}
          onClose={close}
        />
      )}
      {editing?.kind === "agents" && (
        <JsonDocEditor
          title="Agents"
          help={`One entry per workspace agent: kind is deck | comms | ideation | audit, schedule is null or "nightly", model null uses the workspace default. ${refHelp}`}
          value={state.agents}
          schema={AgentsInputSchema}
          onSave={(a) => {
            onAgents(a);
            close();
          }}
          onClose={close}
        />
      )}
      {editing?.kind === "calendar" && (
        <CalendarEditor
          event={editing.event}
          projects={state.projects}
          existing={state.calendar}
          today={today}
          onSave={(ev, isNew) => {
            onCalendar(ev, isNew);
            close();
          }}
          onDelete={(id) => {
            onDeleteCalendar(id);
            close();
          }}
          onClose={close}
        />
      )}
    </div>
  );
}
