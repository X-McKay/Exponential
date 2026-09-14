// ================= view state ↔ URL hash, keyboard chords =================

import { useCallback, useEffect, useState } from "react";
import { PROJECT_TABS } from "@valueflow/domain";
import type { ProjectTab } from "@valueflow/domain";

export type Page = "glance" | "inbox" | "portfolio" | "agents" | "data" | "project";

/** Sections of the Agents page, each with its own URL. */
export type AgentsSection = "agents" | "rules" | "quality";
export const AGENTS_SECTIONS: readonly AgentsSection[] = ["agents", "rules", "quality"];

export interface View {
  page: Page;
  projectId: string | null;
  tab: ProjectTab;
  section: AgentsSection;
  /** Referenced release, governance item or milestone within the tab. */
  focusId?: string;
}

export const HOME: View = { page: "glance", projectId: null, tab: "overview", section: "agents" };

const isTab = (s: string): s is ProjectTab => (PROJECT_TABS as readonly string[]).includes(s);
const isSection = (s: string): s is AgentsSection => (AGENTS_SECTIONS as readonly string[]).includes(s);

export const parseHash = (hash: string): View => {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const [head, a, b, focus] = parts;
  const decode = (value: string): string => { try { return decodeURIComponent(value); } catch { return value; } };
  switch (head) {
    case "inbox":
      return { ...HOME, page: "inbox" };
    case "portfolio":
      return { ...HOME, page: "portfolio" };
    case "agents":
      return { ...HOME, page: "agents", section: a && isSection(a) ? a : "agents" };
    case "data":
      return { ...HOME, page: "data" };
    case "project":
      if (a) return { ...HOME, page: "project", projectId: decode(a), tab: b && isTab(b) ? b : "overview", ...(focus ? { focusId: decode(focus) } : {}) };
      return HOME;
    default:
      return HOME;
  }
};

export const toHash = (v: View): string => {
  switch (v.page) {
    case "glance":
      return "#/glance";
    case "inbox":
      return "#/inbox";
    case "portfolio":
      return "#/portfolio";
    case "agents":
      return v.section === "agents" ? "#/agents" : `#/agents/${v.section}`;
    case "data":
      return "#/data";
    case "project":
      return `#/project/${encodeURIComponent(v.projectId ?? "")}/${v.tab}${v.focusId ? `/${encodeURIComponent(v.focusId)}` : ""}`;
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
  { key: "i", label: "Inbox", target: "inbox" },
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
  toggleChat: () => void;
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
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        disarm();
        h.toggleChat();
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
          case "inbox":
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
