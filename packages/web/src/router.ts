// ================= view state ↔ URL hash, keyboard chords =================

import { useCallback, useEffect, useState } from "react";
import { PROJECT_TABS } from "@valueflow/domain";
import type { ProjectTab } from "@valueflow/domain";

export type Page = "glance" | "portfolio" | "agents" | "data" | "project";

export interface View {
  page: Page;
  projectId: string | null;
  tab: ProjectTab;
}

export const HOME: View = { page: "glance", projectId: null, tab: "overview" };

const isTab = (s: string): s is ProjectTab => (PROJECT_TABS as readonly string[]).includes(s);

export const parseHash = (hash: string): View => {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const [head, a, b] = parts;
  switch (head) {
    case "portfolio":
      return { page: "portfolio", projectId: null, tab: "overview" };
    case "agents":
      return { page: "agents", projectId: null, tab: "overview" };
    case "data":
      return { page: "data", projectId: null, tab: "overview" };
    case "project":
      if (a) return { page: "project", projectId: decodeURIComponent(a), tab: b && isTab(b) ? b : "overview" };
      return HOME;
    default:
      return HOME;
  }
};

export const toHash = (v: View): string => {
  switch (v.page) {
    case "glance":
      return "#/glance";
    case "portfolio":
      return "#/portfolio";
    case "agents":
      return "#/agents";
    case "data":
      return "#/data";
    case "project":
      return `#/project/${encodeURIComponent(v.projectId ?? "")}/${v.tab}`;
  }
};

export const useView = (): [View, (v: View) => void] => {
  const [view, setViewState] = useState<View>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onHash = () => setViewState(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const setView = useCallback((v: View) => {
    const h = toHash(v);
    if (window.location.hash !== h) window.location.hash = h;
    else setViewState(v);
  }, []);
  return [view, setView];
};

// ---- keyboard -----------------------------------------------------------

/** `g`-prefixed navigation chords, Linear style. */
export const CHORDS: readonly { key: string; label: string; target: Page | ProjectTab }[] = [
  { key: "g", label: "Glance", target: "glance" },
  { key: "p", label: "Portfolio", target: "portfolio" },
  { key: "a", label: "Agents", target: "agents" },
  { key: "o", label: "Overview", target: "overview" },
  { key: "v", label: "Value", target: "value" },
  { key: "r", label: "Roadmap", target: "roadmap" },
  { key: "d", label: "Development", target: "development" },
  { key: "n", label: "Governance", target: "governance" },
];

const CHORD_TIMEOUT_MS = 900;

const inEditable = (t: EventTarget | null): boolean => {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable;
};

export interface KeyboardHandlers {
  togglePalette: () => void;
  closeAll: () => void;
  goPage: (page: Exclude<Page, "project">) => void;
  goTab: (tab: ProjectTab) => void;
}

/** Returns whether a `g` chord is currently pending (for the on-screen hint). */
export const useKeyboard = (h: KeyboardHandlers): boolean => {
  const [pending, setPending] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let armed = false;
    const disarm = () => {
      armed = false;
      setPending(false);
      if (timer) clearTimeout(timer);
      timer = null;
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        disarm();
        h.togglePalette();
        return;
      }
      if (e.key === "Escape") {
        disarm();
        h.closeAll();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || inEditable(e.target)) return;
      const k = e.key.toLowerCase();
      if (armed) {
        const chord = CHORDS.find((c) => c.key === k);
        disarm();
        if (!chord) return;
        e.preventDefault();
        switch (chord.target) {
          case "glance":
          case "portfolio":
          case "agents":
          case "data":
            h.goPage(chord.target);
            break;
          case "overview":
          case "value":
          case "roadmap":
          case "development":
          case "governance":
            h.goTab(chord.target);
            break;
        }
        return;
      }
      if (k === "g" && !e.shiftKey) {
        armed = true;
        setPending(true);
        timer = setTimeout(disarm, CHORD_TIMEOUT_MS);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      disarm();
    };
  }, [h]);
  return pending;
};

export const useNarrow = (breakpoint = 760): boolean => {
  const [narrow, setNarrow] = useState(() => window.innerWidth < breakpoint);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < breakpoint);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [breakpoint]);
  return narrow;
};
