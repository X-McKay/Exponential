import { useState } from "react";
import type { Agent, AppState, DevActivity, FeedDay, Upcoming, Workspace } from "@valueflow/domain";
import { AgentsInputSchema, DevActivitySchema, FeedInputSchema, UpcomingInputSchema } from "@valueflow/shared";
import { JsonDocEditor } from "../editors/JsonDocEditor.tsx";
import { WorkspaceEditor } from "../editors/WorkspaceEditor.tsx";
import { Avatar, SectionCard, ghostBtn } from "../ui/primitives.tsx";
import { C } from "../theme.ts";

/** Starting point for a project that has no development activity yet. */
export const DEV_TEMPLATE: DevActivity = {
  stats: { coverage: 0, quality: "B", buildPass: 100, mergedPRs: 0, medianReview: "0h", deploys: 0 },
  repos: [],
  activitySeed: 1,
  activityLevel: 3,
  prs: [],
  builds: [],
  people: [],
};

type Editing = { kind: "workspace" } | { kind: "agents" } | { kind: "feed" } | { kind: "upcoming" } | { kind: "dev"; pid: string } | null;

function Row({ title, sub, action, onClick }: { title: string; sub: string; action: string; onClick: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderTop: `1px solid ${C.line}` }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13, color: C.text, display: "block" }}>{title}</span>
        <span style={{ fontSize: 12, color: C.dim }}>{sub}</span>
      </span>
      <button type="button" className="vf-ghost" onClick={onClick} style={ghostBtn}>
        {action}
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
  onFeed,
  onUpcoming,
  onDev,
}: {
  state: AppState;
  onWorkspace: (w: Workspace) => void;
  onAgents: (a: Agent[]) => void;
  onFeed: (f: FeedDay[]) => void;
  onUpcoming: (u: Upcoming[]) => void;
  onDev: (pid: string, d: DevActivity) => void;
}) {
  const [editing, setEditing] = useState<Editing>(null);
  const close = () => setEditing(null);
  const feedItems = state.feed.reduce((a, d) => a + d.items.length, 0);
  const projectIds = state.projects.map((p) => p.id).join(", ");
  const refHelp = `Project ids in use: ${projectIds}. Tabs: overview, value, roadmap, development, governance.`;

  return (
    <div style={{ padding: "16px 20px 30px", maxWidth: 860 }}>
      <div style={{ fontSize: 13, color: C.mut, lineHeight: 1.6, marginBottom: 14 }}>
        Projects, milestones, governance items, and releases are edited on their own pages. This page covers the rest: who you are, and the documents mirrored from
        external systems. Documents are validated against the API schema before they can be saved, so a typo can never break a page.
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
        <Row title="Activity feed" sub={`${count(state.feed.length, "day")}, ${count(feedItems, "item")} · the "Recent activity" card and CI signals on Glance`} action="Edit JSON" onClick={() => setEditing({ kind: "feed" })} />
        <Row title="Calendar" sub={`${count(state.upcoming.length, "upcoming item")} · the "Coming up" card and the narrative's next date`} action="Edit JSON" onClick={() => setEditing({ kind: "upcoming" })} />
      </SectionCard>

      <SectionCard title="Development activity" pad="0 14px 4px">
        {state.projects.length === 0 && <div style={{ fontSize: 12, color: C.dim, padding: "12px 0" }}>No projects yet.</div>}
        {state.projects.map((p) => {
          const d = state.dev[p.id];
          return (
            <Row
              key={p.id}
              title={p.name}
              sub={d ? `${count(d.repos.length, "repo")}, ${count(d.prs.length, "PR")}, ${count(d.builds.length, "build")}, ${count(d.people.length, "contributor")}` : "No development data connected"}
              action={d ? "Edit JSON" : "Add data"}
              onClick={() => setEditing({ kind: "dev", pid: p.id })}
            />
          );
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
          help={`One entry per workspace agent. Sessions link to a project and tab. ${refHelp}`}
          value={state.agents}
          schema={AgentsInputSchema}
          onSave={(a) => {
            onAgents(a);
            close();
          }}
          onClose={close}
        />
      )}
      {editing?.kind === "feed" && (
        <JsonDocEditor
          title="Activity feed"
          help={`Days in display order, newest first. Item types: build, eval, merge, deploy, gov, ship. ${refHelp}`}
          value={state.feed}
          schema={FeedInputSchema}
          onSave={(f) => {
            onFeed(f);
            close();
          }}
          onClose={close}
        />
      )}
      {editing?.kind === "upcoming" && (
        <JsonDocEditor
          title="Calendar"
          help={`Upcoming items in date order; the first one is quoted in the Glance narrative. ${refHelp}`}
          value={state.upcoming}
          schema={UpcomingInputSchema}
          onSave={(u) => {
            onUpcoming(u);
            close();
          }}
          onClose={close}
        />
      )}
      {editing?.kind === "dev" && (
        <JsonDocEditor
          title={`Development activity — ${state.projects.find((p) => p.id === editing.pid)?.name ?? editing.pid}`}
          help="Stats, repositories, pull requests, builds, and contributors as mirrored from CI and source control. Percentages are 0–100."
          value={state.dev[editing.pid] ?? DEV_TEMPLATE}
          schema={DevActivitySchema}
          onSave={(d) => {
            onDev(editing.pid, d);
            close();
          }}
          onClose={close}
        />
      )}
    </div>
  );
}
