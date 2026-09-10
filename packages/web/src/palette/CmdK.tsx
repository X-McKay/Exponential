import { useEffect, useMemo, useRef, useState } from "react";
import type { Project, ProjectTab } from "@valueflow/domain";
import { CHORDS } from "../router.ts";
import { Kbd, reset } from "../ui/primitives.tsx";
import { C } from "../theme.ts";

type Go = (page: "glance" | "portfolio" | "agents" | "project", projectId: string | null, tab?: ProjectTab) => void;

interface Item {
  id: string;
  label: string;
  hint: string;
  group: "Recent" | "Pages" | "Projects" | "Project views";
  act: () => void;
}

const TABS: [string, ProjectTab][] = [
  ["Value", "value"],
  ["Roadmap", "roadmap"],
  ["Development", "development"],
  ["Governance", "governance"],
];

const RECENT_KEY = "valueflow.palette.recent";
const RECENT_MAX = 4;

const readRecent = (): string[] => {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

const pushRecent = (id: string) => {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...readRecent().filter((x) => x !== id)].slice(0, RECENT_MAX)));
  } catch {
    /* storage unavailable: recents are a convenience only */
  }
};

const buildItems = (projects: Project[], go: Go): Item[] => [
  { id: "glance", label: "Glance", hint: "g g", group: "Pages", act: () => go("glance", null) },
  { id: "portfolio", label: "Portfolio", hint: "g p", group: "Pages", act: () => go("portfolio", null) },
  { id: "agents", label: "Agents", hint: "g a", group: "Pages", act: () => go("agents", null) },
  ...projects.map((p): Item => ({ id: `p:${p.id}`, label: p.name, hint: p.key, group: "Projects", act: () => go("project", p.id, "overview") })),
  ...projects.flatMap((p): Item[] =>
    TABS.map(([t, tab]): Item => ({ id: `p:${p.id}:${tab}`, label: `${p.name} › ${t}`, hint: p.key, group: "Project views", act: () => go("project", p.id, tab) })),
  ),
];

/** Subsequence match, so "imagov" finds "IMA compliance › Governance". */
const matches = (label: string, q: string): boolean => {
  const l = label.toLowerCase();
  let i = 0;
  for (const ch of q) {
    i = l.indexOf(ch, i);
    if (i < 0) return false;
    i += 1;
  }
  return true;
};

export function CmdK({ projects, go, onClose }: { projects: Project[]; go: Go; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const all = useMemo(() => buildItems(projects, go), [projects, go]);

  const items = useMemo<Item[]>(() => {
    const s = q.trim().toLowerCase();
    if (s) {
      const direct = all.filter((i) => i.label.toLowerCase().includes(s));
      const fuzzy = all.filter((i) => !direct.includes(i) && matches(i.label, s));
      return [...direct, ...fuzzy];
    }
    const recent = readRecent()
      .map((id) => all.find((i) => i.id === id))
      .filter((i): i is Item => i !== undefined)
      .map((i): Item => ({ ...i, group: "Recent" }));
    const rest = all.filter((i) => !recent.some((r) => r.id === i.id));
    return [...recent, ...rest].slice(0, 12);
  }, [q, all]);

  const run = (it: Item) => {
    pushRecent(it.id);
    it.act();
  };

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  let lastGroup: Item["group"] | null = null;

  return (
    <div className="vf-overlay" onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(4,5,7,0.7)", zIndex: 80, display: "flex", justifyContent: "center", paddingTop: "14vh" }}>
      <div
        className="vf-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal
        aria-label="Jump to"
        style={{ width: "100%", maxWidth: 540, height: "fit-content", background: "#101114", border: `1px solid ${C.line2}`, borderRadius: 12, boxShadow: "0 24px 70px rgba(0,0,0,.65)", overflow: "hidden" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 16px", borderBottom: `1px solid ${C.line}` }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={C.dim} strokeWidth="1.5" strokeLinecap="round">
            <circle cx="6" cy="6" r="4.2" />
            <path d="M9.2 9.2L12.5 12.5" />
          </svg>
          <input
            autoFocus
            value={q}
            placeholder="Jump to a project or page…"
            aria-label="Jump to"
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((s) => Math.min(s + 1, items.length - 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((s) => Math.max(s - 1, 0));
              }
              if (e.key === "Enter") {
                const it = items[sel];
                if (it) run(it);
              }
            }}
            style={{ boxSizing: "border-box", flex: 1, background: "transparent", border: "none", color: C.text, fontSize: 14, padding: "14px 0", outline: "none", fontFamily: "inherit" }}
          />
          <Kbd>esc</Kbd>
        </div>
        <div ref={listRef} style={{ maxHeight: 360, overflowY: "auto", padding: "6px 6px 8px" }}>
          {items.length === 0 && <div style={{ fontSize: 13, color: C.dim, padding: "14px 12px" }}>No matches.</div>}
          {items.map((it, i) => {
            const header = it.group !== lastGroup ? it.group : null;
            lastGroup = it.group;
            return (
              <div key={it.id}>
                {header && <div style={{ fontSize: 11, color: C.dim, padding: i === 0 ? "6px 10px 4px" : "12px 10px 4px", letterSpacing: "0.02em" }}>{header}</div>}
                <button
                  type="button"
                  data-index={i}
                  onClick={() => run(it)}
                  onMouseMove={() => setSel(i)}
                  aria-selected={i === sel}
                  style={{
                    ...reset,
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    height: 34,
                    padding: "0 10px",
                    borderRadius: 6,
                    background: i === sel ? "#191B20" : "transparent",
                    transition: "background .08s",
                  }}
                >
                  <span style={{ fontSize: 13, color: i === sel ? C.text : "#C6CAD6", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.label}</span>
                  {it.group === "Pages" || (it.group === "Recent" && it.hint.startsWith("g ")) ? (
                    <span style={{ display: "inline-flex", gap: 3 }}>
                      {it.hint.split(" ").map((k, ki) => (
                        <Kbd key={ki}>{k}</Kbd>
                      ))}
                    </span>
                  ) : (
                    <span style={{ fontSize: 11, color: C.dim }}>{it.hint}</span>
                  )}
                  {i === sel && <Kbd>↵</Kbd>}
                </button>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 14, alignItems: "center", padding: "8px 12px", borderTop: `1px solid ${C.line}`, fontSize: 11, color: C.dim, flexWrap: "wrap" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> navigate
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <Kbd>↵</Kbd> open
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }} title={CHORDS.map((c) => `g ${c.key}  ${c.label}`).join("\n")}>
            <Kbd>g</Kbd> then a key to jump
          </span>
        </div>
      </div>
    </div>
  );
}
