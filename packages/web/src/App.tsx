import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { PROJECT_TABS, blockers, calendarOf, dayLabel, pendingProposals } from "@valueflow/domain";
import type { Dim, ProjectTab } from "@valueflow/domain";
import { AgentsInputSchema } from "@valueflow/shared";
import { JsonDocEditor } from "./editors/JsonDocEditor.tsx";
import { ProjectEditor } from "./editors/ProjectEditor.tsx";
import { SetupWizard } from "./editors/SetupWizard.tsx";
import { WorkspaceEditor } from "./editors/WorkspaceEditor.tsx";
import { CmdK } from "./palette/CmdK.tsx";
import { ChatPanel } from "./ui/ChatPanel.tsx";
import { AgentsPage } from "./pages/AgentsPage.tsx";
import { DataPage } from "./pages/DataPage.tsx";
import { DevPage } from "./pages/DevPage.tsx";
import { GlancePage } from "./pages/GlancePage.tsx";
import { InboxPage } from "./pages/InboxPage.tsx";
import { GovernancePage } from "./pages/GovernancePage.tsx";
import { OverviewPage } from "./pages/OverviewPage.tsx";
import { PortfolioPage } from "./pages/PortfolioPage.tsx";
import { RoadmapPage } from "./pages/RoadmapPage.tsx";
import { ValuePage } from "./pages/ValuePage.tsx";
import { CHORDS, useKeyboard, useNarrow, useView } from "./router.ts";
import type { AgentsSection, Page, View } from "./router.ts";
import { useStore } from "./state/store.ts";
import { Avatar, JobBar, Kbd, Skeleton, TierBadge, Tip, Toasts, reset } from "./ui/primitives.tsx";
import { C, FONT, TIER_COLOR, applyTheme, readTheme } from "./theme.ts";
import type { ThemeChoice } from "./theme.ts";

const TAB_LABEL: Record<ProjectTab, string> = { overview: "Overview", value: "Value", roadmap: "Roadmap", development: "Development", governance: "Governance" };

// 14px monochrome glyphs for the primary nav, drawn inline so no icon set ships.
const ICONS = {
  glance: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 1.5v1.6M7 10.9v1.6M1.5 7h1.6M10.9 7h1.6M3.1 3.1l1.2 1.2M9.7 9.7l1.2 1.2M3.1 10.9l1.2-1.2M9.7 4.3l1.2-1.2" />
      <circle cx="7" cy="7" r="2.4" />
    </svg>
  ),
  portfolio: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
      <rect x="1.75" y="1.75" width="4.2" height="4.2" rx="1" />
      <rect x="8.05" y="1.75" width="4.2" height="4.2" rx="1" />
      <rect x="1.75" y="8.05" width="4.2" height="4.2" rx="1" />
      <rect x="8.05" y="8.05" width="4.2" height="4.2" rx="1" />
    </svg>
  ),
  agents: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="10" height="7.5" rx="2" />
      <path d="M7 1.8V4M5 7.5h.01M9 7.5h.01M5 10h4" />
    </svg>
  ),
  inbox: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 8.2l1.6-4.7h6.8L12 8.2v3.3H2z" />
      <path d="M2 8.2h3l.8 1.6h2.4l.8-1.6h3" />
    </svg>
  ),
  data: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="7" cy="3.5" rx="4.6" ry="1.9" />
      <path d="M2.4 3.5v7c0 1.05 2.06 1.9 4.6 1.9s4.6-.85 4.6-1.9v-7M2.4 7c0 1.05 2.06 1.9 4.6 1.9s4.6-.85 4.6-1.9" />
    </svg>
  ),
} as const;

function NavItem({
  label,
  icon,
  dot,
  keys,
  badge,
  active,
  onClick,
}: {
  label: string;
  icon?: keyof typeof ICONS;
  dot?: string;
  keys?: string[];
  /** A count on the right, for the inbox. */
  badge?: number;
  active: boolean;
  onClick: () => void;
}) {
  const button = (
    <button
      type="button"
      onClick={onClick}
      className="vf-nav"
      data-active={active ? "1" : "0"}
      aria-current={active ? "page" : undefined}
      style={{
        ...reset,
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        height: 28,
        padding: "0 8px",
        fontSize: 13,
        fontWeight: active ? 500 : 400,
        borderRadius: 6,
        color: active ? C.text : C.mut,
        background: active ? C.hover : "transparent",
        boxSizing: "border-box",
        transition: "background .12s, color .12s",
      }}
    >
      {icon && <span style={{ display: "inline-flex", color: active ? C.text : C.dim, flexShrink: 0 }}>{ICONS[icon]}</span>}
      {dot && <span style={{ width: 7, height: 7, borderRadius: "50%", background: dot, flexShrink: 0, marginLeft: 3, marginRight: 1 }} />}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: 1 }}>{label}</span>
      {badge !== undefined && badge > 0 && (
        <span style={{ fontSize: 11, fontWeight: 550, color: "#fff", background: C.indigo, borderRadius: 9, minWidth: 18, height: 18, padding: "0 5px", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{badge}</span>
      )}
    </button>
  );
  return keys ? (
    <Tip label={label} keys={keys} side="right" style={{ display: "flex", width: "100%" }}>
      {button}
    </Tip>
  ) : (
    button
  );
}

const SKELETON_ROWS = [0.55, 0.7, 0.45];

/** Layout-shaped placeholder while /api/state loads: sidebar, header, a KPI row, two cards. */
function LoadingShell() {
  return (
    <div style={{ display: "flex", minHeight: "100vh", background: C.bg, fontFamily: FONT }} aria-busy aria-label="Loading ValueFlow">
      <aside style={{ width: 232, flexShrink: 0, borderRight: `1px solid ${C.line}`, padding: "14px 10px" }}>
        <Skeleton w={110} h={16} style={{ margin: "6px 8px 18px" }} />
        <Skeleton h={28} style={{ marginBottom: 12 }} />
        {SKELETON_ROWS.map((w, i) => (
          <Skeleton key={i} w={`${w * 100}%`} h={12} style={{ margin: "10px 8px" }} />
        ))}
      </aside>
      <main style={{ flex: 1, padding: "16px 20px" }}>
        <Skeleton w={160} h={16} style={{ marginBottom: 22 }} />
        <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
          <Skeleton h={78} />
          <Skeleton h={78} />
          <Skeleton h={78} />
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <Skeleton h={180} />
          <Skeleton h={180} />
        </div>
      </main>
    </div>
  );
}

function Header({ children }: { children: ReactNode }) {
  return <header style={{ padding: "13px 20px", borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "baseline", gap: 10 }}>{children}</header>;
}

export function App() {
  const store = useStore();
  const [view, setView] = useView();
  const [openMs, setOpenMs] = useState<string | null>(null);
  const [dim, setDim] = useState<Dim>("fte");
  const [palette, setPalette] = useState(false);
  const [chat, setChat] = useState(false);
  const narrow = useNarrow();
  const [lastProject, setLastProject] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ kind: "project"; pid: string | null } | { kind: "setup" } | { kind: "agents" } | { kind: "workspace" } | null>(null);
  const [theme, setTheme] = useState<ThemeChoice>(readTheme);
  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const state = store.state;
  const projects = state?.projects ?? [];
  const proj = projects.find((p) => p.id === view.projectId);

  const nav = useCallback(
    (v: View) => {
      setView(v);
      setOpenMs(null);
      setPalette(false);
      if (v.projectId) setLastProject(v.projectId);
    },
    [setView],
  );
  const go = useCallback(
    (page: Page, projectId: string | null, tab: ProjectTab = "overview", section: AgentsSection = "agents") => nav({ page, projectId, tab, section }),
    [nav],
  );
  const openProject = useCallback((id: string, tab: ProjectTab = "overview") => nav({ page: "project", projectId: id, tab, section: "agents" }), [nav]);

  const keyboard = useMemo(
    () => ({
      togglePalette: () => setPalette((v) => !v),
      toggleChat: () => setChat((v) => !v),
      closeAll: () => {
        setPalette(false);
        setChat(false);
      },
      goPage: (page: "glance" | "inbox" | "portfolio" | "agents" | "data") => go(page, null),
      goTab: (tab: ProjectTab) => {
        const pid = view.projectId ?? lastProject ?? projects[0]?.id;
        if (pid) openProject(pid, tab);
      },
    }),
    [go, openProject, view.projectId, lastProject, projects],
  );
  const chordPending = useKeyboard(keyboard);

  if (!state) {
    if (store.error) {
      return (
        <div style={{ minHeight: "100vh", background: C.bg, color: C.redHi, fontFamily: FONT, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>
          Could not load state: {store.error}
        </div>
      );
    }
    return <LoadingShell />;
  }

  const user = state.workspace.user;
  const firstName = user.name.split(/\s+/)[0] ?? user.name;
  const cal = calendarOf(state);
  const closeEditor = () => setEditor(null);
  const waiting = pendingProposals(state).length;
  const themeNext: Record<ThemeChoice, ThemeChoice> = { system: "light", light: "dark", dark: "system" };
  const themeLabel: Record<ThemeChoice, string> = { system: "Theme: follows the system", light: "Theme: light", dark: "Theme: dark" };

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: C.bg, color: C.text, fontFamily: FONT, fontSize: 14 }}>
      {palette && <CmdK projects={projects} go={go} onClose={() => setPalette(false)} />}
      {chat && state.llm && (
        <ChatPanel
          state={state}
          currentProject={view.projectId ?? lastProject}
          onOpen={openProject}
          onProposals={store.addProposals}
          onDecide={(id, d) => void store.decideProposal(id, d)}
          onClose={() => setChat(false)}
        />
      )}
      {state.llm && !chat && (
        <Tip label="Ask the workspace" keys={["⌘", "J"]}>
          <button
            type="button"
            onClick={() => setChat(true)}
            aria-label="Ask the workspace"
            style={{
              ...reset,
              position: "fixed",
              right: 18,
              bottom: 18,
              zIndex: 55,
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              height: 36,
              padding: "0 14px 0 10px",
              borderRadius: 18,
              background: C.raised,
              border: `1px solid ${C.line2}`,
              color: C.text,
              fontSize: 13,
              boxShadow: `0 8px 24px ${C.shadow}`,
            }}
          >
            <span style={{ width: 18, height: 18, borderRadius: 5, background: "linear-gradient(135deg,#EEEFF1,#8A8F98)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 600, color: C.bg }}>A</span>
            Ask
          </button>
        </Tip>
      )}
      {editor?.kind === "project" && (
        <ProjectEditor
          project={editor.pid ? (projects.find((p) => p.id === editor.pid) ?? null) : null}
          projects={projects}
          onSave={(input, isNew) => {
            void store.saveProject(input, isNew);
            closeEditor();
            if (isNew) openProject(input.id);
          }}
          onDelete={(pid) => {
            void store.deleteProject(pid);
            closeEditor();
            go("portfolio", null);
          }}
          onClose={closeEditor}
        />
      )}
      {editor?.kind === "setup" && (
        <SetupWizard
          projects={projects}
          cal={cal}
          defaultOwner={user.ini}
          onCreated={(pid) => {
            closeEditor();
            void store.reload().then(() => openProject(pid));
          }}
          onClose={closeEditor}
        />
      )}
      {editor?.kind === "agents" && (
        <JsonDocEditor
          title="Agents"
          help="One entry per workspace agent: id, name, grad (CSS gradient), purpose, kind (deck | comms | ideation | audit | chat | rules | brief | tuner | scout), model (null = workspace default), owner initials, caps, schedule (null | nightly | weekly), prompt (extra instructions or null; a change is recorded as a prompt version). Runs are kept when an agent is edited and removed when it is deleted."
          value={state.agents}
          schema={AgentsInputSchema}
          onSave={(agents) => {
            void store.saveAgents(agents);
            closeEditor();
          }}
          onClose={closeEditor}
        />
      )}
      {editor?.kind === "workspace" && (
        <WorkspaceEditor
          workspace={state.workspace}
          onSave={(w) => {
            void store.saveWorkspace(w);
            closeEditor();
          }}
          onClose={closeEditor}
        />
      )}
      {!narrow && (
        <aside style={{ width: 232, flexShrink: 0, borderRight: `1px solid ${C.line}`, padding: "14px 10px", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 8px 12px" }}>
            <span style={{ width: 20, height: 20, borderRadius: 6, background: "linear-gradient(135deg,#5C6AF0,#8B5CF0)", boxShadow: `0 0 12px ${C.accentLine2}` }} />
            <span style={{ fontSize: 14, fontWeight: 550, letterSpacing: "-0.01em" }}>ValueFlow</span>
          </div>
          <button
            type="button"
            className="vf-search"
            onClick={() => setPalette(true)}
            style={{ ...reset, display: "flex", alignItems: "center", gap: 7, margin: "0 0 10px", height: 30, padding: "0 9px", borderRadius: 6, border: `1px solid ${C.line2}`, background: C.popover, transition: "border-color .12s" }}
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke={C.dim} strokeWidth="1.5" strokeLinecap="round">
              <circle cx="6" cy="6" r="4.2" />
              <path d="M9.2 9.2L12.5 12.5" />
            </svg>
            <span style={{ fontSize: 12, color: C.dim, flex: 1 }}>Jump to…</span>
            <Kbd>⌘K</Kbd>
          </button>
          <NavItem label="Glance" icon="glance" keys={["g", "g"]} active={view.page === "glance"} onClick={() => go("glance", null)} />
          <NavItem label="Inbox" icon="inbox" keys={["g", "i"]} badge={waiting} active={view.page === "inbox"} onClick={() => go("inbox", null)} />
          <NavItem label="Portfolio" icon="portfolio" keys={["g", "p"]} active={view.page === "portfolio"} onClick={() => go("portfolio", null)} />
          <NavItem label="Agents" icon="agents" keys={["g", "a"]} active={view.page === "agents"} onClick={() => go("agents", null)} />
          <NavItem label="Data" icon="data" active={view.page === "data"} onClick={() => go("data", null)} />
          <div style={{ padding: "16px 8px 6px", fontSize: 11, color: C.dim, letterSpacing: "0.06em", textTransform: "uppercase" }}>Projects</div>
          {projects.map((p) => (
            <NavItem key={p.id} label={p.name} dot={p.tier ? TIER_COLOR[p.tier] : C.dim} active={view.projectId === p.id} onClick={() => openProject(p.id)} />
          ))}
          <div style={{ flex: 1 }} />
          <Tip label={themeLabel[theme]} side="right" style={{ display: "flex", width: "100%" }}>
            <button
              type="button"
              className="vf-nav"
              onClick={() => setTheme(themeNext[theme])}
              aria-label={themeLabel[theme]}
              style={{ ...reset, display: "flex", alignItems: "center", gap: 8, width: "100%", height: 28, padding: "0 8px", borderRadius: 6, color: C.mut, fontSize: 12 }}
            >
              <span style={{ display: "inline-flex", color: C.dim }}>
                {theme === "light" ? (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                    <circle cx="7" cy="7" r="2.6" />
                    <path d="M7 1.5v1.4M7 11.1v1.4M1.5 7h1.4M11.1 7h1.4M3.1 3.1l1 1M9.9 9.9l1 1M3.1 10.9l1-1M9.9 4.1l1-1" />
                  </svg>
                ) : theme === "dark" ? (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
                    <path d="M11.5 8.6A5 5 0 0 1 5.4 2.5a5 5 0 1 0 6.1 6.1z" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4">
                    <circle cx="7" cy="7" r="5" />
                    <path d="M7 2a5 5 0 0 1 0 10z" fill="currentColor" stroke="none" />
                  </svg>
                )}
              </span>
              <span style={{ flex: 1, textAlign: "left" }}>{theme === "system" ? "System theme" : theme === "light" ? "Light theme" : "Dark theme"}</span>
            </button>
          </Tip>
          <Tip label="Workspace settings" side="right" style={{ display: "flex", width: "100%" }}>
            <button
              type="button"
              className="vf-nav"
              onClick={() => setEditor({ kind: "workspace" })}
              style={{ ...reset, display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "10px 8px 6px", borderTop: `1px solid ${C.line}`, borderRadius: 0 }}
            >
              <Avatar ini={user.ini} size={22} />
              <span style={{ fontSize: 12, color: C.mut, flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.name}</span>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.green, display: "block" }} />
            </button>
          </Tip>
        </aside>
      )}

      <main style={{ flex: 1, minWidth: 0 }}>
        {narrow && (
          <nav className="vf-topnav" aria-label="Pages">
            {(
              [
                ["glance", "Glance"],
                ["inbox", "Inbox"],
                ["portfolio", "Portfolio"],
                ["agents", "Agents"],
                ["data", "Data"],
              ] as const
            ).map(([page, label]) => (
              <button
                key={page}
                type="button"
                onClick={() => go(page, null)}
                className="vf-nav"
                data-active={view.page === page ? "1" : "0"}
                aria-current={view.page === page ? "page" : undefined}
                style={{ ...reset, display: "inline-flex", alignItems: "center", gap: 6, height: 28, padding: "0 9px", borderRadius: 6, fontSize: 12.5, color: view.page === page ? C.text : C.mut, background: view.page === page ? C.hover : "transparent" }}
              >
                <span style={{ display: "inline-flex", color: view.page === page ? C.text : C.dim }}>{ICONS[page]}</span>
                {label}
                {page === "inbox" && waiting > 0 && (
                  <span style={{ fontSize: 10.5, fontWeight: 550, color: "#fff", background: C.indigo, borderRadius: 8, minWidth: 16, height: 16, padding: "0 4px", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{waiting}</span>
                )}
              </button>
            ))}
            <span style={{ flex: 1 }} />
            <button type="button" onClick={() => setPalette(true)} className="vf-ghost" style={{ ...reset, fontSize: 12, color: C.dim, padding: "0 8px", height: 28 }} aria-label="Jump to">
              ⌘K
            </button>
          </nav>
        )}
        {store.job && <JobBar kind={store.job.kind ?? "benchmark"} done={store.job.done} total={store.job.total} />}
        {view.page === "glance" ? (
          <>
            <Header>
              <h1 style={{ fontSize: 15, fontWeight: 550, letterSpacing: "-0.01em", margin: 0 }}>Glance</h1>
              <span style={{ fontSize: 12, color: C.dim }}>{dayLabel(state.asOf)}</span>
            </Header>
            <GlancePage
              state={state}
              userName={firstName}
              onOpen={openProject}
              onOpenAgents={() => go("agents", null)}
              onOpenInbox={() => go("inbox", null)}
              onDecide={(id, d) => void store.decideProposal(id, d)}
              onRate={(id, r) => void store.rateRun(id, r)}
              onCurate={store.curateGlance}
              onSeen={store.markGlanceSeen}
            />
          </>
        ) : view.page === "inbox" ? (
          <>
            <Header>
              <h1 style={{ fontSize: 15, fontWeight: 550, letterSpacing: "-0.01em", margin: 0 }}>Inbox</h1>
              <span style={{ fontSize: 12, color: C.dim }}>{waiting ? `${waiting} waiting on you` : "nothing waiting"}</span>
            </Header>
            <InboxPage state={state} onDecide={(id, d) => void store.decideProposal(id, d)} />
          </>
        ) : view.page === "agents" ? (
          <>
            <Header>
              <h1 style={{ fontSize: 15, fontWeight: 550, letterSpacing: "-0.01em", margin: 0 }}>Agents</h1>
              <span style={{ fontSize: 12, color: C.dim }}>
                {state.agents.length} workspace agents{state.llm ? ` · ${state.llm.model ?? "model resolving"}` : " · no model configured"}
              </span>
            </Header>
            <AgentsPage
              agents={state.agents}
              runs={state.runs}
              proposals={state.proposals}
              scores={state.scores}
              rules={state.rules}
              promptVersions={state.promptVersions}
              projects={projects}
              asOf={state.asOf}
              llm={state.llm}
              userIni={user.ini}
              currentProject={view.projectId ?? lastProject}
              section={view.section}
              busy={store.job?.kind ?? null}
              onSection={(s) => go("agents", null, "overview", s)}
              onOpen={openProject}
              onOpenInbox={() => go("inbox", null)}
              onEdit={() => setEditor({ kind: "agents" })}
              onRun={(input) => void store.runAgent(input)}
              onDecide={(id, d) => void store.decideProposal(id, d)}
              onRate={(id, r, n) => void store.rateRun(id, r, n)}
              onJudge={store.judgeRun}
              onBenchmark={store.runBenchmark}
              onScout={store.runScout}
              onSetPrompt={(id, prompt) => void store.setAgentPrompt(id, prompt)}
              onSaveRule={(rule, input) => void store.saveRule(rule, input)}
              onDeleteRule={(id) => void store.deleteRule(id)}
            />
          </>
        ) : view.page === "portfolio" ? (
          <>
            <Header>
              <h1 style={{ fontSize: 15, fontWeight: 550, letterSpacing: "-0.01em", margin: 0 }}>AI project portfolio</h1>
            </Header>
            <PortfolioPage
              projects={projects}
              onOpen={(id) => openProject(id)}
              onNew={() => setEditor({ kind: "project", pid: null })}
              onSetup={() => setEditor({ kind: "setup" })}
              canSetup={state.llm !== null}
            />
          </>
        ) : view.page === "data" ? (
          <>
            <Header>
              <h1 style={{ fontSize: 15, fontWeight: 550, letterSpacing: "-0.01em", margin: 0 }}>Data</h1>
              <span style={{ fontSize: 12, color: C.dim }}>workspace settings and external-system documents</span>
            </Header>
            <DataPage
              state={state}
              onWorkspace={(w) => void store.saveWorkspace(w)}
              onAgents={(a) => void store.saveAgents(a)}
              onCalendar={(ev, isNew) => void store.saveCalendar(ev, isNew)}
              onDeleteCalendar={(id) => void store.deleteCalendar(id)}
              onSync={store.syncProject}
            />
          </>
        ) : proj ? (
          <>
            <header style={{ padding: "13px 20px 0", borderBottom: `1px solid ${C.line}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <button type="button" onClick={() => go("portfolio", null)} style={{ ...reset, fontSize: 12, color: C.dim }}>
                  Portfolio ›
                </button>
                <span style={{ fontSize: 12, color: C.dim }}>{proj.key}</span>
                <h1 style={{ fontSize: 15, fontWeight: 550, letterSpacing: "-0.01em", margin: 0, flex: 1, minWidth: 160 }}>{proj.name}</h1>
                <TierBadge tier={proj.tier} />
              </div>
              <div style={{ display: "flex", gap: 4, marginTop: 10 }}>
                {PROJECT_TABS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setView({ ...view, tab: k })}
                    className="vf-tab"
                    aria-current={view.tab === k ? "page" : undefined}
                    style={{ ...reset, fontSize: 13, padding: "7px 12px", color: view.tab === k ? C.text : C.mut, borderBottom: `2px solid ${view.tab === k ? C.indigo : "transparent"}`, transition: "color .12s, border-color .12s" }}
                  >
                    {TAB_LABEL[k]}
                    {k === "governance" && blockers(proj) > 0 && <span style={{ color: C.red }}> ·</span>}
                  </button>
                ))}
              </div>
            </header>
            {view.tab === "overview" && <OverviewPage p={proj} onEdit={() => setEditor({ kind: "project", pid: proj.id })} />}
            {view.tab === "value" && (
              <ValuePage
                p={proj}
                cal={cal}
                onMetric={store.setMetric}
                openMs={openMs}
                setOpenMs={setOpenMs}
                dim={dim}
                setDim={setDim}
                onSaveMilestone={(pid, ms, isNew) => void store.saveMilestone(pid, ms, isNew)}
                onDeleteMilestone={(pid, mid) => void store.deleteMilestone(pid, mid)}
                onSaveTargets={(pid, t) => void store.saveTargets(pid, t)}
              />
            )}
            {view.tab === "roadmap" && (
              <RoadmapPage
                p={proj}
                releases={state.releases[proj.id] ?? []}
                cal={cal}
                onSaveRelease={(pid, rel, isNew) => void store.saveRelease(pid, rel, isNew)}
                onDeleteRelease={(pid, rid) => void store.deleteRelease(pid, rid)}
              />
            )}
            {view.tab === "development" && <DevPage facts={state.dev[proj.id]} project={proj} asOf={state.asOf} source={state.syncSource} onSync={() => store.syncProject(proj.id)} />}
            {view.tab === "governance" && (
              <GovernancePage
                p={proj}
                defaultOwner={user.ini}
                onSaveGov={(pid, item, isNew) => void store.saveGovernance(pid, item, isNew)}
                onDeleteGov={(pid, gid) => void store.deleteGovernance(pid, gid)}
              />
            )}
          </>
        ) : (
          <div style={{ padding: "16px 20px", fontSize: 13, color: C.dim }}>Project not found.</div>
        )}
      </main>

      {chordPending && (
        <div className="vf-chord" role="status">
          <Kbd>g</Kbd> then
          {CHORDS.map((c) => (
            <span key={c.key} style={{ display: "inline-flex", alignItems: "center", gap: 4, marginLeft: 4 }}>
              <Kbd>{c.key}</Kbd>
              {c.label}
            </span>
          ))}
        </div>
      )}
      <Toasts
        notices={[...(store.error ? [{ id: -1, text: `Save failed — ${store.error}. State reloaded from server.`, tone: "bad" as const }] : []), ...store.notices]}
        onDismiss={(id) => (id === -1 ? store.clearError() : store.dismissNotice(id))}
      />
    </div>
  );
}
