import { useMemo, useState } from "react";
import type { Project, ProjectTab } from "@valueflow/domain";
import { CHORDS } from "../router.ts";
import { reset } from "../ui/primitives.tsx";
import { C } from "../theme.ts";

interface Item {
  label: string;
  hint: string;
  act: () => void;
}

const TABS: [string, ProjectTab][] = [
  ["Value", "value"],
  ["Roadmap", "roadmap"],
  ["Development", "development"],
  ["Governance", "governance"],
];

export function CmdK({
  projects,
  go,
  onClose,
}: {
  projects: Project[];
  go: (page: "glance" | "portfolio" | "agents" | "project", projectId: string | null, tab?: ProjectTab) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const items = useMemo<Item[]>(() => {
    const base: Item[] = [
      { label: "Glance", hint: "Briefing", act: () => go("glance", null) },
      { label: "Portfolio", hint: "All projects", act: () => go("portfolio", null) },
      { label: "Agents", hint: "Workspace agents", act: () => go("agents", null) },
      ...projects.flatMap((p): Item[] => [
        { label: p.name, hint: p.key, act: () => go("project", p.id, "overview") },
        ...TABS.map(([t, tab]): Item => ({ label: `${p.name} › ${t}`, hint: p.key, act: () => go("project", p.id, tab) })),
      ]),
    ];
    const s = q.trim().toLowerCase();
    return s ? base.filter((i) => i.label.toLowerCase().includes(s)) : base.slice(0, 9);
  }, [q, projects, go]);

  return (
    <div className="vf-overlay" onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(4,5,7,0.7)", zIndex: 80, display: "flex", justifyContent: "center", paddingTop: "14vh" }}>
      <div
        className="vf-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Jump to"
        style={{ width: "100%", maxWidth: 520, height: "fit-content", background: "#101114", border: `1px solid ${C.line2}`, borderRadius: 12, boxShadow: "0 24px 70px rgba(0,0,0,.65)", overflow: "hidden" }}
      >
        <input
          autoFocus
          value={q}
          placeholder="Jump to a project or page…"
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
            if (e.key === "Enter") items[sel]?.act();
          }}
          style={{ boxSizing: "border-box", width: "100%", background: "transparent", border: "none", borderBottom: `1px solid ${C.line}`, color: C.text, fontSize: 14, padding: "13px 16px", outline: "none", fontFamily: "inherit" }}
        />
        <div style={{ maxHeight: 320, overflowY: "auto", padding: 6 }}>
          {items.length === 0 && <div style={{ fontSize: 12.5, color: C.dim, padding: "14px 12px" }}>No matches.</div>}
          {items.map((it, i) => (
            <button
              key={it.label}
              type="button"
              onClick={it.act}
              onMouseEnter={() => setSel(i)}
              style={{ ...reset, width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 7, background: i === sel ? "#191B20" : "transparent" }}
            >
              <span style={{ fontSize: 13, color: C.text, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.label}</span>
              <span style={{ fontSize: 10.5, color: C.dim }}>{it.hint}</span>
              {i === sel && <span style={{ fontSize: 10, color: C.dim, border: `1px solid ${C.line2}`, borderRadius: 4, padding: "0 4px", lineHeight: "15px" }}>↵</span>}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 12, padding: "8px 12px", borderTop: `1px solid ${C.line}`, fontSize: 10.5, color: C.dim, flexWrap: "wrap" }}>
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
          <span style={{ flex: 1 }} />
          <span title={CHORDS.map((c) => `g ${c.key} → ${c.label}`).join("\n")}>g + key to jump</span>
        </div>
      </div>
    </div>
  );
}
