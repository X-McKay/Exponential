import { useMemo, useState } from "react";
import { dateLabel, relTime, workspaceDrift } from "@valueflow/domain";
import type { Agent, AppState, CalendarEvent, ProjectTemplate, Workspace } from "@valueflow/domain";
import { AgentsInputSchema, TemplatesInputSchema, WorkspaceExportSchema } from "@valueflow/shared";
import type { WorkspaceExport } from "@valueflow/shared";
import { api } from "../api/client.ts";
import type { ImportSummary } from "../api/client.ts";
import { Btn, Chip, Modal } from "../ui/primitives.tsx";
import { CalendarEditor } from "../editors/CalendarEditor.tsx";
import { JsonDocEditor } from "../editors/JsonDocEditor.tsx";
import { WorkspaceEditor } from "../editors/WorkspaceEditor.tsx";
import { Avatar, SectionCard, ghostBtn } from "../ui/primitives.tsx";
import { C } from "../theme.ts";

type Editing = { kind: "workspace" } | { kind: "agents" } | { kind: "templates" } | { kind: "import" } | { kind: "calendar"; event: CalendarEvent | null } | null;

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

/** Hand a JSON document to the browser as a file. */
const download = (name: string, body: string): void => {
  const url = URL.createObjectURL(new Blob([body], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/** Read, validate, and describe an export before it is written into the workspace. */
function ImportDialog({ hasProjects, onImport, onClose }: { hasProjects: boolean; onImport: (doc: WorkspaceExport, replace: boolean) => Promise<ImportSummary>; onClose: () => void }) {
  const [doc, setDoc] = useState<WorkspaceExport | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<ImportSummary | null>(null);
  const read = async (file: File) => {
    setFileName(file.name);
    setDoc(null);
    setProblem(null);
    try {
      const parsed = WorkspaceExportSchema.safeParse(JSON.parse(await file.text()));
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        setProblem(`Not a workspace export: ${first ? `${first.path.join(".") || "document"}: ${first.message}` : "unknown shape"}`);
        return;
      }
      setDoc(parsed.data);
    } catch (e) {
      setProblem(`Could not read the file: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const submit = async () => {
    if (!doc || busy || (hasProjects && !replace)) return;
    setBusy(true);
    setProblem(null);
    try {
      setDone(await onImport(doc, replace));
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const pending = doc?.proposals.filter((p) => p.state === "pending").length ?? 0;
  return (
    <Modal
      title="Import a workspace"
      onClose={onClose}
      onSubmit={() => void submit()}
      footer={
        <>
          <Btn onClick={onClose}>{done ? "Done" : "Cancel"}</Btn>
          {!done && (
            <Btn tone={replace ? "danger" : "primary"} disabled={!doc || busy || (hasProjects && !replace)} onClick={() => void submit()}>
              {busy ? "Importing…" : replace ? "Replace this workspace" : "Import"}
            </Btn>
          )}
        </>
      }
    >
      {done ? (
        <div role="status" style={{ fontSize: 13, color: C.text2, lineHeight: 1.6, marginTop: 8 }}>
          Imported {count(done.projects, "project")}, {count(done.milestones, "milestone")}, {count(done.governance, "governance item")}, {count(done.releases, "release")}, {count(done.readings, "reading")}, {count(done.calendar, "calendar event")}, {count(done.rules, "rule")}, {count(done.runs, "run")}, and {count(done.proposals, "proposal")}.
          {done.skipped ? ` ${count(done.skipped, "record")} referenced something not in the document and ${done.skipped === 1 ? "was" : "were"} skipped.` : ""}
        </div>
      ) : (
        <>
          <div style={{ fontSize: 12, color: C.mut, lineHeight: 1.55, marginTop: 8 }}>
            Choose a file exported from Exponential. It is checked against the same schema the server enforces before anything is written; the import is all or nothing.
          </div>
          <label style={{ display: "block", marginTop: 12, fontSize: 12, color: C.mut }}>
            Workspace file
            <input type="file" accept="application/json,.json" aria-label="Workspace file" onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); }} style={{ display: "block", marginTop: 6, color: C.text, fontSize: 12 }} />
          </label>
          {problem && <div role="alert" style={{ color: C.redHi, fontSize: 12, marginTop: 8 }}>{problem}</div>}
          {doc && (
            <div style={{ marginTop: 12, background: C.inset, border: `1px solid ${C.line}`, borderRadius: 8, padding: "10px 12px", fontSize: 12, color: C.text2, lineHeight: 1.6 }}>
              <div style={{ color: C.text, fontWeight: 500 }}>{fileName} · exported {dateLabel(doc.exportedAt.slice(0, 10))}</div>
              <div>Owner {doc.workspace.user.name} · {count(doc.projects.length, "project")} · {count(doc.projects.reduce((n, p) => n + p.milestones.length, 0), "milestone")} · {count(doc.projects.reduce((n, p) => n + p.governance.length, 0), "governance item")} · {count(doc.projects.reduce((n, p) => n + p.releases.length, 0), "release")}</div>
              <div>{count(doc.agents.length, "agent")} · {count(doc.templates.length, "template")} · {count(doc.rules.length, "rule")} · {count(doc.calendar.length, "calendar event")} · {count(doc.runs.length, "run")} · {count(pending, "pending proposal")}</div>
            </div>
          )}
          {hasProjects && (
            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 12, fontSize: 12, color: C.text2, lineHeight: 1.5, cursor: "pointer" }}>
              <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} style={{ accentColor: C.red, marginTop: 2 }} />
              <span>This workspace already has projects. Replace them, along with runs, proposals, rules, budgets, and calendar events, with the contents of this file. This cannot be undone; export first if in doubt.</span>
            </label>
          )}
        </>
      )}
    </Modal>
  );
}

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
  onTemplates,
  onCalendar,
  onDeleteCalendar,
  onSync,
  onImport,
  onOpen,
}: {
  state: AppState;
  onWorkspace: (w: Workspace) => Promise<unknown>;
  onAgents: (a: Agent[]) => Promise<unknown>;
  onTemplates: (t: ProjectTemplate[]) => Promise<unknown>;
  onCalendar: (ev: CalendarEvent, isNew: boolean) => Promise<unknown>;
  onDeleteCalendar: (id: string) => Promise<unknown>;
  onSync: (pid: string) => Promise<void>;
  onImport?: (doc: WorkspaceExport, replace: boolean) => Promise<ImportSummary>;
  /** Open a project's governance page, where drift is reviewed. */
  onOpen?: (pid: string) => void;
}) {
  const [editing, setEditing] = useState<Editing>(null);
  const close = () => setEditing(null);
  const projectIds = state.projects.map((p) => p.id).join(", ");
  const refHelp = `Project ids in use: ${projectIds}. Tabs: overview, value, roadmap, development, governance.`;
  const today = state.asOf.slice(0, 10);
  const projectName = (pid: string): string => state.projects.find((p) => p.id === pid)?.name ?? pid;
  const newest = state.events[0];
  const drift = useMemo(() => workspaceDrift(state), [state]);
  const drifting = drift.filter((d) => !d.drift.aligned);
  const versionOf = (tid: string): number | null => (state.templateVersions ?? []).find((v) => v.templateId === tid)?.version ?? null;
  const exportNow = async () => {
    const doc = await api.exportWorkspace();
    download(`exponential-workspace-${doc.exportedAt.slice(0, 10)}.json`, JSON.stringify(doc, null, 2));
  };

  return (
    <div className="vf-container" style={{ padding: "16px 20px 30px", maxWidth: 860 }}>
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
        <Row title="Project templates" sub={`${count(state.templates?.length ?? 0, "template")} · the documents, dependencies, and first plan a new project starts with · every save is versioned (${(state.templates ?? []).map((t) => `${t.name} v${versionOf(t.id) ?? "?"}`).join(", ") || "none"})`} action="Edit JSON" onClick={() => setEditing({ kind: "templates" })} />
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderTop: `1px solid ${C.line}`, flexWrap: "wrap" }}>
          <span style={{ flex: "1 1 240px", minWidth: 0 }}>
            <span style={{ fontSize: 13, color: C.text, display: "block" }}>Template drift</span>
            <span style={{ fontSize: 12, color: C.dim }}>
              {drift.length === 0 ? "No project follows a template yet; link one on a project's Governance page." : drifting.length === 0 ? `All ${count(drift.length, "project")} following a template carry every required item.` : `${count(drifting.length, "project")} of ${drift.length} missing required items`}
            </span>
          </span>
          {drifting.length > 0 && (
            <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
              {drifting.map((d) => (
                <button key={d.project.id} type="button" className="vf-ghost" onClick={() => onOpen?.(d.project.id)} style={{ ...ghostBtn, height: 24, gap: 6 }}>
                  {d.project.name} <Chip tone="warn">{d.drift.missingRequired.length} missing</Chip>
                </button>
              ))}
            </span>
          )}
        </div>
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

      <SectionCard title="Transfer" pad="0 14px 4px">
        <Row title="Export this workspace" sub="One JSON file with projects, readings, releases, calendar, agents, templates, rules, budgets, recent runs, and the inbox. No credentials." action="Download JSON" onClick={exportNow} />
        {onImport && <Row title="Import a workspace" sub={state.projects.length ? "Into an empty workspace, or replace this one after confirming." : "This workspace is empty: an exported file lands here as is."} action="Import…" onClick={() => setEditing({ kind: "import" })} />}
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
          onSave={async (w) => {
            await onWorkspace(w);
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
          onSave={async (a) => {
            await onAgents(a);
            close();
          }}
          onClose={close}
        />
      )}
      {editing?.kind === "templates" && (
        <JsonDocEditor
          title="Project templates"
          help="One entry per template: id, name, description, stage, tier (1-3 or null), targets, documents (cat, name, detail, required), dependencies (name, detail, required; tracked as governance items under Dependencies), milestones (name, monthsOut, impact, metrics), and releases (name, monthsOut, milestone indices, criteria of type gate | document | manual). Projects already created from a template are not changed."
          value={state.templates ?? []}
          schema={TemplatesInputSchema}
          onSave={async (t) => {
            await onTemplates(t);
            close();
          }}
          onClose={close}
        />
      )}
      {editing?.kind === "import" && onImport && <ImportDialog hasProjects={state.projects.length > 0} onImport={onImport} onClose={close} />}
      {editing?.kind === "calendar" && (
        <CalendarEditor
          event={editing.event}
          projects={state.projects}
          existing={state.calendar}
          today={today}
          onSave={async (ev, isNew) => {
            await onCalendar(ev, isNew);
            close();
          }}
          onDelete={async (id) => {
            await onDeleteCalendar(id);
            close();
          }}
          onClose={close}
        />
      )}
    </div>
  );
}
