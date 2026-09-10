import { useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { PROJECT_TABS, TODAY_DATE, blockers } from "@valueflow/domain";
import type { Dim, ProjectTab } from "@valueflow/domain";
import { CmdK } from "./palette/CmdK.tsx";
import { AgentsPage } from "./pages/AgentsPage.tsx";
import { DevPage } from "./pages/DevPage.tsx";
import { GlancePage } from "./pages/GlancePage.tsx";
import { GovernancePage } from "./pages/GovernancePage.tsx";
import { OverviewPage } from "./pages/OverviewPage.tsx";
import { PortfolioPage } from "./pages/PortfolioPage.tsx";
import { RoadmapPage } from "./pages/RoadmapPage.tsx";
import { ValuePage } from "./pages/ValuePage.tsx";
import { CHORDS, useKeyboard, useNarrow, useView } from "./router.ts";
import type { Page, View } from "./router.ts";
import { useStore } from "./state/store.ts";
import { Avatar, TierBadge, reset } from "./ui/primitives.tsx";
import { C, FONT } from "./theme.ts";

const USER = { ini: "AM", name: "Al McKay", first: "Al" };

const TAB_LABEL: Record<ProjectTab, string> = { overview: "Overview", value: "Value", roadmap: "Roadmap", development: "Development", governance: "Governance" };

const todayLabel = (): string => new Date(`${TODAY_DATE}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

function NavItem({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="vf-nav"
      data-active={active ? "1" : "0"}
      style={{
        ...reset,
        display: "block",
        width: "100%",
        padding: "6px 8px",
        fontSize: 13,
        borderRadius: 6,
        color: active ? C.text : C.mut,
        background: active ? "#17181C" : "transparent",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        transition: "background .12s, color .12s",
      }}
    >
      {label}
    </button>
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
  const narrow = useNarrow();
  const [lastProject, setLastProject] = useState<string | null>(null);

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
    (page: Page, projectId: string | null, tab: ProjectTab = "overview") => nav({ page, projectId, tab }),
    [nav],
  );
  const openProject = useCallback((id: string, tab: ProjectTab = "overview") => nav({ page: "project", projectId: id, tab }), [nav]);

  const keyboard = useMemo(
    () => ({
      togglePalette: () => setPalette((v) => !v),
      closeAll: () => setPalette(false),
      goPage: (page: "glance" | "portfolio" | "agents") => go(page, null),
      goTab: (tab: ProjectTab) => {
        const pid = view.projectId ?? lastProject ?? projects[0]?.id;
        if (pid) openProject(pid, tab);
      },
    }),
    [go, openProject, view.projectId, lastProject, projects],
  );
  const chordPending = useKeyboard(keyboard);

  if (!state) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, color: C.dim, fontFamily: FONT, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {store.error ? <span style={{ color: "#F08A84" }}>Could not load state: {store.error}</span> : <span className="vf-pulse">Loading ValueFlow…</span>}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: C.bg, color: C.text, fontFamily: FONT, fontSize: 14 }}>
      {palette && <CmdK projects={projects} go={go} onClose={() => setPalette(false)} />}
      {!narrow && (
        <aside style={{ width: 218, flexShrink: 0, borderRight: `1px solid ${C.line}`, padding: "14px 10px", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 8px 12px" }}>
            <span style={{ width: 20, height: 20, borderRadius: 5, background: "linear-gradient(135deg,#5C6AF0,#8B5CF0)", boxShadow: "0 0 12px rgba(110,123,242,.35)" }} />
            <span style={{ fontSize: 13.5, fontWeight: 600, letterSpacing: "-0.01em" }}>ValueFlow</span>
          </div>
          <button
            type="button"
            className="vf-search"
            onClick={() => setPalette(true)}
            style={{ ...reset, display: "flex", alignItems: "center", gap: 7, margin: "0 0 10px", padding: "6px 9px", borderRadius: 7, border: `1px solid ${C.line2}`, background: "#0C0D0F", transition: "border-color .12s" }}
          >
            <span style={{ fontSize: 11.5, color: C.dim }}>⌕</span>
            <span style={{ fontSize: 12, color: C.dim, flex: 1 }}>Jump to…</span>
            <span style={{ fontSize: 10, color: C.dim, border: `1px solid ${C.line2}`, borderRadius: 4, padding: "0 4px", lineHeight: "15px" }}>⌘K</span>
          </button>
          <NavItem label="Glance" active={view.page === "glance"} onClick={() => go("glance", null)} />
          <NavItem label="Portfolio" active={view.page === "portfolio"} onClick={() => go("portfolio", null)} />
          <NavItem label="Agents" active={view.page === "agents"} onClick={() => go("agents", null)} />
          <div style={{ padding: "14px 8px 5px", fontSize: 10, color: C.dim, letterSpacing: "0.08em", textTransform: "uppercase" }}>Projects</div>
          {projects.map((p) => (
            <NavItem key={p.id} label={p.name} active={view.projectId === p.id} onClick={() => openProject(p.id)} />
          ))}
          <div style={{ flex: 1 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 8px 2px", borderTop: `1px solid ${C.line}` }}>
            <Avatar ini={USER.ini} size={22} />
            <span style={{ fontSize: 12, color: C.mut, flex: 1 }}>{USER.name}</span>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.green }} title="Online" />
          </div>
        </aside>
      )}

      <main style={{ flex: 1, minWidth: 0 }}>
        {view.page === "glance" ? (
          <>
            <Header>
              <h1 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>Glance</h1>
              <span style={{ fontSize: 12, color: C.dim }}>{todayLabel()}</span>
            </Header>
            <GlancePage state={state} userName={USER.first} onOpen={openProject} />
          </>
        ) : view.page === "agents" ? (
          <>
            <Header>
              <h1 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>Agents</h1>
              <span style={{ fontSize: 12, color: C.dim }}>{state.agents.length} workspace agents</span>
            </Header>
            <AgentsPage agents={state.agents} projects={projects} onOpen={openProject} />
          </>
        ) : view.page === "portfolio" ? (
          <>
            <Header>
              <h1 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>AI project portfolio</h1>
            </Header>
            <PortfolioPage projects={projects} onOpen={(id) => openProject(id)} />
          </>
        ) : proj ? (
          <>
            <header style={{ padding: "13px 20px 0", borderBottom: `1px solid ${C.line}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <button type="button" onClick={() => go("portfolio", null)} style={{ ...reset, fontSize: 12, color: C.dim }}>
                  Portfolio ›
                </button>
                <span style={{ fontSize: 12, color: C.dim }}>{proj.key}</span>
                <h1 style={{ fontSize: 15, fontWeight: 600, margin: 0, flex: 1, minWidth: 160 }}>{proj.name}</h1>
                <TierBadge tier={proj.tier} />
              </div>
              <div style={{ display: "flex", gap: 4, marginTop: 10 }}>
                {PROJECT_TABS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setView({ ...view, tab: k })}
                    className="vf-tab"
                    style={{ ...reset, fontSize: 12.5, padding: "7px 12px", color: view.tab === k ? C.text : C.dim, borderBottom: `2px solid ${view.tab === k ? C.indigo : "transparent"}`, transition: "color .12s, border-color .12s" }}
                  >
                    {TAB_LABEL[k]}
                    {k === "governance" && blockers(proj) > 0 && <span style={{ color: C.red }}> ·</span>}
                  </button>
                ))}
              </div>
            </header>
            {view.tab === "overview" && <OverviewPage p={proj} />}
            {view.tab === "value" && (
              <ValuePage
                p={proj}
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
            {view.tab === "roadmap" && <RoadmapPage p={proj} releases={state.releases[proj.id] ?? []} />}
            {view.tab === "development" && <DevPage d={state.dev[proj.id]} />}
            {view.tab === "governance" && <GovernancePage p={proj} onSaveGov={(pid, item) => void store.saveGovernance(pid, item)} />}
          </>
        ) : (
          <div style={{ padding: "16px 20px", fontSize: 12.5, color: C.dim }}>Project not found.</div>
        )}
      </main>

      {chordPending && (
        <div className="vf-chord">
          <kbd>g</kbd> then{" "}
          {CHORDS.map((c) => (
            <span key={c.key}>
              <kbd>{c.key}</kbd>
              {c.label}{" "}
            </span>
          ))}
        </div>
      )}
      {store.error && (
        <div className="vf-toast" onClick={store.clearError} role="alert">
          Save failed — {store.error}. State reloaded from server.
        </div>
      )}
    </div>
  );
}
