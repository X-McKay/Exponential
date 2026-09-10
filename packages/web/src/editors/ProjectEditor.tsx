import { useState } from "react";
import { initialsOf, nextProjectKey, slugId } from "@valueflow/domain";
import type { Project, Repo, RiskTier, TeamMember } from "@valueflow/domain";
import type { ProjectInput } from "@valueflow/shared";
import { Btn, Lbl, Modal, Tip, ghostBtn, inpStyle } from "../ui/primitives.tsx";
import { C } from "../theme.ts";

const STAGES = ["Discovery", "Pilot", "Scaling", "Sustain"];
const num = (v: string): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

const blank = (projects: Project[]): ProjectInput => ({
  id: "",
  key: nextProjectKey(projects),
  name: "",
  stage: "Discovery",
  description: "",
  tier: null,
  committee: null,
  repos: [],
  team: [],
  targets: { fte: 30, time: 30 },
});

const fromProject = (p: Project): ProjectInput => ({
  id: p.id,
  key: p.key,
  name: p.name,
  stage: p.stage,
  description: p.description,
  tier: p.tier,
  committee: p.committee ? { ...p.committee } : null,
  repos: p.repos.map((r) => ({ ...r })),
  team: p.team.map((t) => ({ ...t })),
  targets: { ...p.targets },
});

const removeBtn = { ...ghostBtn, width: 26, height: 32, padding: 0, justifyContent: "center", border: "1px solid transparent" } as const;

/** Create or edit a project's own facts: identity, risk, team, repositories, targets. */
export function ProjectEditor({
  project,
  projects,
  onSave,
  onDelete,
  onClose,
}: {
  project: Project | null;
  projects: Project[];
  onSave: (input: ProjectInput, isNew: boolean) => void;
  onDelete?: (pid: string) => void;
  onClose: () => void;
}) {
  const isNew = project === null;
  const [d, setD] = useState<ProjectInput>(() => (project ? fromProject(project) : blank(projects)));
  const [committee, setCommittee] = useState({ date: project?.committee?.date ?? "", ref: project?.committee?.ref ?? "" });
  const [confirmDel, setConfirmDel] = useState(false);
  const set = (patch: Partial<ProjectInput>) => setD((x) => ({ ...x, ...patch }));
  const setTeam = (i: number, patch: Partial<TeamMember>) => setD((x) => ({ ...x, team: x.team.map((t, ti) => (ti === i ? { ...t, ...patch } : t)) }));
  const setRepo = (i: number, patch: Partial<Repo>) => setD((x) => ({ ...x, repos: x.repos.map((r, ri) => (ri === i ? { ...r, ...patch } : r)) }));

  const id = isNew ? slugId(d.name, projects.map((p) => p.id), "project") : d.id;
  const committeeOk = (committee.date === "" && committee.ref === "") || (/^\d{4}-\d{2}-\d{2}$/.test(committee.date) && committee.ref.trim() !== "");
  const valid =
    d.name.trim() !== "" &&
    d.key.trim() !== "" &&
    d.stage.trim() !== "" &&
    committeeOk &&
    d.team.every((t) => t.name.trim() !== "" && t.role.trim() !== "" && t.ini.trim() !== "") &&
    d.repos.every((r) => r.name.trim() !== "" && r.url.trim() !== "");

  const submit = () => {
    if (!valid) return;
    onSave(
      {
        ...d,
        id,
        key: d.key.trim(),
        name: d.name.trim(),
        stage: d.stage.trim(),
        committee: committee.date && committee.ref ? { date: committee.date, ref: committee.ref.trim() } : null,
        team: d.team.map((t) => ({ ini: t.ini.trim().toUpperCase(), name: t.name.trim(), role: t.role.trim() })),
        repos: d.repos.map((r) => ({ name: r.name.trim(), url: r.url.trim() })),
      },
      isNew,
    );
  };

  return (
    <Modal
      title={isNew ? "New project" : `Edit ${d.key}`}
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          {!isNew && onDelete && (
            <span style={{ marginRight: "auto" }}>
              <Btn tone="danger" onClick={() => (confirmDel ? onDelete(d.id) : setConfirmDel(true))}>
                {confirmDel ? "Confirm delete project" : "Delete project"}
              </Btn>
            </span>
          )}
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn tone="primary" disabled={!valid} onClick={submit}>
            {isNew ? "Create project" : "Save changes"}
          </Btn>
        </>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 110px", gap: 10 }}>
        <div>
          <Lbl>Name</Lbl>
          <input style={inpStyle} value={d.name} autoFocus={isNew} placeholder="e.g. KYC refresh automation" onChange={(e) => set({ name: e.target.value })} />
        </div>
        <div>
          <Lbl>Key</Lbl>
          <input style={inpStyle} value={d.key} onChange={(e) => set({ key: e.target.value })} />
        </div>
      </div>
      {isNew && d.name.trim() !== "" && <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>URL id: {id}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <Lbl>Stage</Lbl>
          <input list="vf-stages" style={inpStyle} value={d.stage} onChange={(e) => set({ stage: e.target.value })} />
          <datalist id="vf-stages">
            {STAGES.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
        <div>
          <Lbl>AI risk tier</Lbl>
          <select style={inpStyle} value={d.tier ?? ""} onChange={(e) => set({ tier: e.target.value === "" ? null : (Number(e.target.value) as RiskTier) })}>
            <option value="">Untiered</option>
            <option value="1">Tier 1 · High risk</option>
            <option value="2">Tier 2 · Medium risk</option>
            <option value="3">Tier 3 · Low risk</option>
          </select>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <Lbl>AI committee approval date</Lbl>
          <input
            style={{ ...inpStyle, borderColor: committeeOk ? C.line2 : "rgba(229,83,75,.6)" }}
            value={committee.date}
            placeholder="YYYY-MM-DD (blank = pending)"
            onChange={(e) => setCommittee((c) => ({ ...c, date: e.target.value }))}
          />
        </div>
        <div>
          <Lbl>Committee reference</Lbl>
          <input style={inpStyle} value={committee.ref} placeholder="AIRC-2026-…" onChange={(e) => setCommittee((c) => ({ ...c, ref: e.target.value }))} />
        </div>
      </div>

      <Lbl>Description</Lbl>
      <textarea
        style={{ ...inpStyle, height: "auto", minHeight: 76, padding: "8px 10px", resize: "vertical", lineHeight: 1.5 }}
        value={d.description}
        onChange={(e) => set({ description: e.target.value })}
      />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <Lbl>FTE reduction target (%)</Lbl>
          <input type="number" style={inpStyle} value={d.targets.fte} onChange={(e) => set({ targets: { ...d.targets, fte: num(e.target.value) } })} />
        </div>
        <div>
          <Lbl>Time reduction target (%)</Lbl>
          <input type="number" style={inpStyle} value={d.targets.time} onChange={(e) => set({ targets: { ...d.targets, time: num(e.target.value) } })} />
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "16px 0 4px" }}>
        <span style={{ fontSize: 12, color: C.mut }}>Team</span>
        <button type="button" onClick={() => setD((x) => ({ ...x, team: [...x.team, { ini: "", name: "", role: "" }] }))} style={{ ...ghostBtn, border: "none", color: C.indigoHi }}>
          + Add member
        </button>
      </div>
      {d.team.length === 0 && <div style={{ fontSize: 12, color: C.dim, padding: "6px 0 2px" }}>No team members yet.</div>}
      {d.team.map((t, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 56px 26px", gap: 6, alignItems: "end", marginBottom: 6 }}>
          <div>
            {i === 0 && <div style={{ fontSize: 11, color: C.dim, marginBottom: 3 }}>Name</div>}
            <input
              style={inpStyle}
              value={t.name}
              placeholder="e.g. Dan K."
              onChange={(e) => setTeam(i, { name: e.target.value, ...(t.ini === "" || t.ini === initialsOf(t.name) ? { ini: initialsOf(e.target.value) } : {}) })}
            />
          </div>
          <div>
            {i === 0 && <div style={{ fontSize: 11, color: C.dim, marginBottom: 3 }}>Role</div>}
            <input style={inpStyle} value={t.role} placeholder="e.g. ML Engineer" onChange={(e) => setTeam(i, { role: e.target.value })} />
          </div>
          <div>
            {i === 0 && <div style={{ fontSize: 11, color: C.dim, marginBottom: 3 }}>Initials</div>}
            <input style={inpStyle} value={t.ini} maxLength={3} onChange={(e) => setTeam(i, { ini: e.target.value.toUpperCase() })} />
          </div>
          <Tip label="Remove member">
            <button type="button" aria-label="Remove member" className="vf-ghost" onClick={() => setD((x) => ({ ...x, team: x.team.filter((_, ti) => ti !== i) }))} style={removeBtn}>
              ✕
            </button>
          </Tip>
        </div>
      ))}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "16px 0 4px" }}>
        <span style={{ fontSize: 12, color: C.mut }}>Repositories</span>
        <button type="button" onClick={() => setD((x) => ({ ...x, repos: [...x.repos, { name: "", url: "" }] }))} style={{ ...ghostBtn, border: "none", color: C.indigoHi }}>
          + Add repository
        </button>
      </div>
      {d.repos.length === 0 && <div style={{ fontSize: 12, color: C.dim, padding: "6px 0 2px" }}>No repositories linked.</div>}
      {d.repos.map((r, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr 26px", gap: 6, alignItems: "end", marginBottom: 6 }}>
          <div>
            {i === 0 && <div style={{ fontSize: 11, color: C.dim, marginBottom: 3 }}>Name</div>}
            <input
              style={inpStyle}
              value={r.name}
              placeholder="e.g. kyc-agent"
              onChange={(e) => setRepo(i, { name: e.target.value, ...(r.url === "" || r.url === `github.com/org/${r.name}` ? { url: `github.com/org/${e.target.value}` } : {}) })}
            />
          </div>
          <div>
            {i === 0 && <div style={{ fontSize: 11, color: C.dim, marginBottom: 3 }}>URL</div>}
            <input style={inpStyle} value={r.url} placeholder="github.com/org/repo" onChange={(e) => setRepo(i, { url: e.target.value })} />
          </div>
          <Tip label="Remove repository">
            <button type="button" aria-label="Remove repository" className="vf-ghost" onClick={() => setD((x) => ({ ...x, repos: x.repos.filter((_, ri) => ri !== i) }))} style={removeBtn}>
              ✕
            </button>
          </Tip>
        </div>
      ))}
      {!isNew && (
        <div style={{ fontSize: 12, color: C.dim, marginTop: 14 }}>Milestones, governance items, and releases are edited on their own pages. Deleting the project removes all of them.</div>
      )}
    </Modal>
  );
}
