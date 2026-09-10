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
import { Avatar, Kbd, Skeleton, TierBadge, Tip, reset } from "./ui/primitives.tsx";
import { C, FONT, TIER_COLOR } from "./theme.ts";

const USER = { ini: "AM", name: "Al McKay", first: "Al" };

const TAB_LABEL: Record<ProjectTab, string> = { overview: "Overview", value: "Value", roadmap: "Roadmap", development: "Development", governance: "Governance" };

const todayLabel = (): string => new Date(`${TODAY_DATE}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

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
} as const;

function NavItem({
  label,
  icon,
  dot,
  keys,
  active,
  onClick,
}: {
  label: string;
  icon?: keyof typeof ICONS;
  dot?: string;
  keys?: string[];
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
        background: active ? "#17181C" : "transparent",
        transition: "background .12s, color .12s",
      }}
    >
      {icon && <span style={{ display: "inline-flex", color: active ? C.text : C.dim, flexShrink: 0 }}>{ICONS[icon]}</span>}
      {dot && <span style={{ width: 7, height: 7, borderRadius: "50%", background: dot, flexShrink: 0, marginLeft: 3, marginRight: 1 }} />}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{label}</span>
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
    if (store.error) {
      return (
        <div style={{ minHeight: "100vh", background: C.bg, color: "#F08A84", fontFamily: FONT, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>
          Could not load state: {store.error}
        </div>
      );
    }
    return <LoadingShell />;
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: C.bg, color: C.text, fontFamily: FONT, fontSize: 14 }}>
      {palette && <CmdK projects={projects} go={go} onClose={() => setPalette(false)} />}
      {!narrow && (
        <aside style={{ width: 232, flexShrink: 0, borderRight: `1px solid ${C.line}`, padding: "14px 10px", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 8px 12px" }}>
            <span style={{ width: 20, height: 20, borderRadius: 6, background: "linear-gradient(135deg,#5C6AF0,#8B5CF0)", boxShadow: "0 0 12px rgba(110,123,242,.35)" }} />
            <span style={{ fontSize: 14, fontWeight: 550, letterSpacing: "-0.01em" }}>ValueFlow</span>
          </div>
          <button
            type="button"
            className="vf-search"
            onClick={() => setPalette(true)}
            style={{ ...reset, display: "flex", alignItems: "center", gap: 7, margin: "0 0 10px", height: 30, padding: "0 9px", borderRadius: 6, border: `1px solid ${C.line2}`, background: "#0C0D0F", transition: "border-color .12s" }}
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke={C.dim} strokeWidth="1.5" strokeLinecap="round">
              <circle cx="6" cy="6" r="4.2" />
              <path d="M9.2 9.2L12.5 12.5" />
            </svg>
            <span style={{ fontSize: 12, color: C.dim, flex: 1 }}>Jump to…</span>
            <Kbd>⌘K</Kbd>
          </button>
          <NavItem label="Glance" icon="glance" keys={["g", "g"]} active={view.page === "glance"} onClick={() => go("glance", null)} />
          <NavItem label="Portfolio" icon="portfolio" keys={["g", "p"]} active={view.page === "portfolio"} onClick={() => go("portfolio", null)} />
          <NavItem label="Agents" icon="agents" keys={["g", "a"]} active={view.page === "agents"} onClick={() => go("agents", null)} />
          <div style={{ padding: "16px 8px 6px", fontSize: 11, color: C.dim, letterSpacing: "0.06em", textTransform: "uppercase" }}>Projects</div>
          {projects.map((p) => (
            <NavItem key={p.id} label={p.name} dot={p.tier ? TIER_COLOR[p.tier] : C.dim} active={view.projectId === p.id} onClick={() => openProject(p.id)} />
          ))}
          <div style={{ flex: 1 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 8px 2px", borderTop: `1px solid ${C.line}` }}>
            <Avatar ini={USER.ini} size={22} />
            <span style={{ fontSize: 12, color: C.mut, flex: 1 }}>{USER.name}</span>
            <Tip label="Online">
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.green, display: "block" }} />
            </Tip>
          </div>
        </aside>
      )}

      <main style={{ flex: 1, minWidth: 0 }}>
        {view.page === "glance" ? (
          <>
            <Header>
              <h1 style={{ fontSize: 15, fontWeight: 550, letterSpacing: "-0.01em", margin: 0 }}>Glance</h1>
              <span style={{ fontSize: 12, color: C.dim }}>{todayLabel()}</span>
            </Header>
            <GlancePage state={state} userName={USER.first} onOpen={openProject} />
          </>
        ) : view.page === "agents" ? (
          <>
            <Header>
              <h1 style={{ fontSize: 15, fontWeight: 550, letterSpacing: "-0.01em", margin: 0 }}>Agents</h1>
              <span style={{ fontSize: 12, color: C.dim }}>{state.agents.length} workspace agents</span>
            </Header>
            <AgentsPage agents={state.agents} projects={projects} onOpen={openProject} />
          </>
        ) : view.page === "portfolio" ? (
          <>
            <Header>
              <h1 style={{ fontSize: 15, fontWeight: 550, letterSpacing: "-0.01em", margin: 0 }}>AI project portfolio</h1>
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
      {store.error && (
        <div className="vf-toast" onClick={store.clearError} role="alert">
          Save failed — {store.error}. State reloaded from server.
        </div>
      )}
    </div>
  );
}
