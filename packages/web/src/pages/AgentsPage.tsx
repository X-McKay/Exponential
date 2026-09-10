import { useState } from "react";
import { AGENT_STATUS_LABEL, SESSION_ICON } from "@valueflow/domain";
import type { Agent, Project, ProjectTab } from "@valueflow/domain";
import { Avatar, Caret, Chip, Kpi, SectionCard, reset } from "../ui/primitives.tsx";
import { AGENT_STATUS, C, SESSION_COLOR } from "../theme.ts";

function AgentAvatar({ a, size = 26 }: { a: Agent; size?: number }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: 8,
        background: a.grad,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.42,
        fontWeight: 600,
        color: "#08090A",
        flexShrink: 0,
        boxShadow: "0 0 10px rgba(255,255,255,.06)",
      }}
    >
      {a.name[0]}
    </span>
  );
}

/** Short project names for the session list (the mockup's byId map), falling back to the first two words. */
const SHORT_NAMES: Record<string, string> = { onboarding: "Client onboarding", ima: "IMA compliance", sector: "Sector reports" };
const shortProjectName = (p: Project | undefined): string => {
  if (!p) return "";
  return SHORT_NAMES[p.id] ?? p.name.split(" ").slice(0, 2).join(" ");
};

export function AgentsPage({ agents, projects, onOpen }: { agents: Agent[]; projects: Project[]; onOpen: (id: string, tab: ProjectTab) => void }) {
  const [open, setOpen] = useState<string | null>(agents.find((a) => a.id === "audie")?.id ?? agents[0]?.id ?? null);
  const totalRuns = agents.reduce((a, x) => a + x.runs, 0);
  const avgSuccess = totalRuns ? Math.round(agents.reduce((a, x) => a + x.success * x.runs, 0) / totalRuns) : 0;
  const workingAgents = agents.filter((a) => a.status === "working");
  const attention = agents.flatMap((a) => a.sessions).filter((s) => s.state === "attention").length;
  const auditors = agents.filter((a) => a.sessions.some((s) => s.state === "attention")).map((a) => a.name);
  const byId = new Map(projects.map((p) => [p.id, p]));

  return (
    <div style={{ padding: "16px 20px 30px" }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <Kpi label="Runs · 30d" value={totalRuns} sub={`across ${agents.length} agents`} color={C.indigoHi} />
        <Kpi label="Success rate" value={`${avgSuccess}%`} sub="accepted without rework" color={C.green} ring={avgSuccess / 100} />
        <Kpi
          label="Active now"
          value={workingAgents.length}
          sub={workingAgents.length ? `${workingAgents.map((a) => a.name).join(", ")} ${workingAgents.length === 1 ? "is" : "are"} drafting` : "all idle"}
          color={workingAgents.length ? C.indigoHi : C.dim}
        />
        <Kpi label="Attention flags" value={attention} sub={auditors.length ? `from ${auditors.join(", ")}'s audit scans` : "none raised"} color={C.amber} />
      </div>

      <SectionCard title="Workspace agents" pad="0" right={<span style={{ fontSize: 12, color: C.indigoHi, cursor: "pointer" }}>+ New agent</span>}>
        <div style={{ display: "flex", gap: 11, padding: "8px 14px", fontSize: 11, color: C.dim, letterSpacing: "0.06em", textTransform: "uppercase", borderBottom: `1px solid ${C.line}` }}>
          <span style={{ width: 26 }} />
          <span style={{ width: 110, flexShrink: 0 }}>Agent</span>
          <span style={{ flex: 1 }}>Purpose</span>
          <span style={{ width: 104, flexShrink: 0 }}>Status</span>
          <span style={{ width: 56, textAlign: "right", flexShrink: 0 }}>Runs</span>
          <span style={{ width: 62, textAlign: "right", flexShrink: 0 }}>Success</span>
          <span style={{ width: 58, textAlign: "right", flexShrink: 0 }}>Last run</span>
          <span style={{ width: 14 }} />
        </div>
        {agents.map((a) => {
          const st = AGENT_STATUS[a.status];
          const isOpen = open === a.id;
          return (
            <div key={a.id} style={{ borderBottom: `1px solid ${C.line}` }}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : a.id)}
                className="vf-row"
                style={{ ...reset, width: "100%", display: "flex", alignItems: "center", gap: 11, padding: "11px 14px", background: isOpen ? C.panel2 : "transparent", transition: "background .12s" }}
              >
                <AgentAvatar a={a} />
                <span style={{ width: 110, flexShrink: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 500, color: C.text, display: "block" }}>{a.name}</span>
                  <span style={{ fontSize: 11, color: C.dim }}>{a.model}</span>
                </span>
                <span style={{ flex: 1, fontSize: 13, color: C.mut, lineHeight: 1.45, minWidth: 0 }}>{a.purpose}</span>
                <span style={{ width: 104, flexShrink: 0, display: "flex", alignItems: "center", gap: 6 }}>
                  <span className={st.pulse ? "vf-pulse" : undefined} style={{ width: 7, height: 7, borderRadius: "50%", background: st.color }} />
                  <span style={{ fontSize: 12, color: st.color }}>{AGENT_STATUS_LABEL[a.status]}</span>
                </span>
                <span style={{ width: 56, textAlign: "right", fontSize: 13, color: C.mut, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{a.runs}</span>
                <span style={{ width: 62, textAlign: "right", fontSize: 13, color: a.success >= 95 ? C.green : C.mut, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{a.success}%</span>
                <span style={{ width: 58, textAlign: "right", fontSize: 12, color: C.dim, flexShrink: 0 }}>{a.last}</span>
                <span style={{ width: 14, textAlign: "center" }}>
                  <Caret open={isOpen} />
                </span>
              </button>
              {isOpen && (
                <div style={{ padding: "2px 14px 14px 51px" }}>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "6px 0 10px" }}>
                    {a.caps.map((c) => (
                      <Chip key={c}>{c}</Chip>
                    ))}
                    <span style={{ flex: 1 }} />
                    <span style={{ fontSize: 11, color: C.dim }}>Owner</span>
                    <Avatar ini={a.owner} size={18} />
                  </div>
                  <div style={{ background: "#0B0C0E", border: `1px solid ${C.line}`, borderRadius: 8, padding: "2px 12px" }}>
                    {a.sessions.map((s2, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => onOpen(s2.proj, s2.tab)}
                        className="vf-row"
                        style={{ ...reset, width: "100%", display: "flex", gap: 10, padding: "9px 2px", borderTop: i === 0 ? "none" : `1px solid ${C.line}`, alignItems: "baseline", transition: "background .12s" }}
                      >
                        <span className={s2.state === "working" ? "vf-pulse" : undefined} style={{ fontSize: 11, color: SESSION_COLOR[s2.state], width: 12, flexShrink: 0 }}>
                          {SESSION_ICON[s2.state]}
                        </span>
                        <span style={{ flex: 1, fontSize: 13, color: s2.state === "attention" ? C.text : "#C6CAD6", lineHeight: 1.5, minWidth: 0 }}>{s2.text}</span>
                        <span style={{ fontSize: 11, color: C.dim, flexShrink: 0 }}>{shortProjectName(byId.get(s2.proj))}</span>
                        <span style={{ fontSize: 11, color: C.dim, width: 44, textAlign: "right", flexShrink: 0 }}>{s2.when}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </SectionCard>

      <div style={{ fontSize: 12, color: C.dim, lineHeight: 1.6, maxWidth: 680 }}>
        Agents run against the same live project state as every other page — Audie's attention flags surface on Glance, and Slider's decks pull current burn-up and gate data at
        generation time.
      </div>
    </div>
  );
}
