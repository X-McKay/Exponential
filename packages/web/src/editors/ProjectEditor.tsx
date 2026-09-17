import { useState } from "react";
import { initialsOf, nextProjectKey, slugId, templateSummary } from "@valueflow/domain";
import type { Project, ProjectTemplate, Repo, RiskTier, TeamMember } from "@valueflow/domain";
import type { ProjectInput } from "@valueflow/shared";
import { Btn, Lbl, Modal, Tip, ghostBtn, inpStyle } from "../ui/primitives.tsx";
import { C } from "../theme.ts";

const STAGES = ["Discovery", "Pilot", "Scaling", "Sustain"];
const num = (v: string): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
const pctOk = (n: number): boolean => Number.isFinite(n) && n >= 0 && n <= 100;
const iniOk = (s: string): boolean => /^[\p{L}\p{N}]{1,3}$/u.test(s.trim());
/** Mirrors the server's URL rule: an http(s) URL, or a bare host like github.com/org/repo. */
export const urlOk = (v: string): boolean => {
  const value = v.trim();
  if (!value) return false;
  if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^https?:\/\//i.test(value)) return false;
  try {
    const parsed = new URL(value.includes("://") ? value : `https://${value}`);
    return Boolean(parsed.hostname) && parsed.hostname.includes(".");
  } catch {
    return false;
  }
};

/** What the create action will do, given a template choice. */
export interface TemplateChoice {
  id: string;
  documentsOnly: boolean;
}

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
  template: p.template ? { ...p.template } : null,
});

const removeBtn = { ...ghostBtn, width: 26, height: 32, padding: 0, justifyContent: "center", border: "1px solid transparent" } as const;

/** Create or edit a project's own facts: identity, risk, team, repositories, targets. */
export function ProjectEditor({
  project,
  projects,
  templates = [],
  onSave,
  onDelete,
  onClose,
}: {
  project: Project | null;
  projects: Project[];
  /** Starting points offered for a new project; the first is preselected. */
  templates?: ProjectTemplate[];
  onSave: (input: ProjectInput, isNew: boolean, template: TemplateChoice | null) => Promise<unknown>;
  onDelete?: (pid: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const isNew = project === null;
  const [d, setD] = useState<ProjectInput>(() => (project ? fromProject(project) : blank(projects)));
  const [templateId, setTemplateId] = useState<string>(() => (project ? "" : templates[0]?.id ?? ""));
  const [documentsOnly, setDocumentsOnly] = useState(false);
  const template = isNew ? templates.find((t) => t.id === templateId) ?? null : null;
  const [committee, setCommittee] = useState({ date: project?.committee?.date ?? "", ref: project?.committee?.ref ?? "" });
  const [confirmDel, setConfirmDel] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const set = (patch: Partial<ProjectInput>) => setD((x) => ({ ...x, ...patch }));
  const setTeam = (i: number, patch: Partial<TeamMember>) => setD((x) => ({ ...x, team: x.team.map((t, ti) => (ti === i ? { ...t, ...patch } : t)) }));
  const setRepo = (i: number, patch: Partial<Repo>) => setD((x) => ({ ...x, repos: x.repos.map((r, ri) => (ri === i ? { ...r, ...patch } : r)) }));

  const id = isNew ? slugId(d.name, projects.map((p) => p.id), "project") : d.id;
  const committeeOk = (committee.date === "" && committee.ref === "") || (/^\d{4}-\d{2}-\d{2}$/.test(committee.date) && committee.ref.trim() !== "");
  const targetsOk = pctOk(d.targets.fte) && pctOk(d.targets.time);
  const teamOk = d.team.every((t) => t.name.trim() !== "" && t.role.trim() !== "" && iniOk(t.ini));
  const reposOk = d.repos.every((r) => r.name.trim() !== "" && urlOk(r.url));
  const problems: string[] = [
    ...(d.name.trim() === "" ? ["a name"] : []),
    ...(d.key.trim() === "" || d.key.trim().length > 16 ? ["a key of at most 16 characters"] : []),
    ...(d.stage.trim() === "" ? ["a stage"] : []),
    ...(committeeOk ? [] : ["a committee date as YYYY-MM-DD with a reference, or both blank"]),
    ...(targetsOk ? [] : ["targets between 0 and 100"]),
    ...(teamOk ? [] : ["a name, role, and 1–3 letter initials for every team member"]),
    ...(reposOk ? [] : ["a name and an http(s) URL or host for every repository"]),
  ];
  const valid = problems.length === 0;

  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(
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
        template ? { id: template.id, documentsOnly } : null,
      );
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    if (!onDelete || saving) return;
    setSaving(true);
    setSaveError(null);
    try { await onDelete(d.id); } catch (e) { setSaveError(e instanceof Error ? e.message : String(e)); setSaving(false); }
  };

  return (
    <Modal
      title={isNew ? "New project" : `Edit ${d.key}`}
      onClose={onClose}
      onSubmit={() => void submit()}
      footer={
        <>
          {!isNew && onDelete && (
            <span style={{ marginRight: "auto" }}>
              <Btn tone="danger" disabled={saving} onClick={() => (confirmDel ? void remove() : setConfirmDel(true))}>
                {confirmDel ? "Confirm delete project" : "Delete project"}
              </Btn>
            </span>
          )}
          <Btn onClick={onClose}>Cancel</Btn>
          <Tip label={valid ? (isNew ? "Create the project" : "Save changes") : `Needs ${problems.join("; ")}`}>
            <Btn tone="primary" disabled={!valid || saving} onClick={() => void submit()}>
              {saving ? "Saving…" : isNew ? "Create project" : "Save changes"}
            </Btn>
          </Tip>
        </>
      }
    >
      {saveError && <div role="alert" style={{ color: C.redHi, fontSize: 12, margin: "8px 0" }}>Could not save: {saveError}</div>}
      {isNew && templates.length > 0 && (
        <div style={{ marginTop: 10, background: C.inset, border: `1px solid ${C.line}`, borderRadius: 8, padding: "10px 12px" }}>
          <div className="vf-fields" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, alignItems: "start" }}>
            <div>
              <Lbl htmlFor="vf-template">Start from template</Lbl>
              <select id="vf-template" style={inpStyle} value={templateId} onChange={(e) => {
                setTemplateId(e.target.value);
                const t = templates.find((x) => x.id === e.target.value);
                if (t) setD((x) => ({ ...x, stage: t.stage, tier: t.tier, targets: { ...t.targets } }));
              }}>
                <option value="">Blank project</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div style={{ fontSize: 12, color: C.mut, lineHeight: 1.5, paddingTop: 12 }}>
              {template ? (
                <>
                  <div>{template.description}</div>
                  <div style={{ color: C.dim, marginTop: 4 }}>Adds {templateSummary(template)}. Documents and dependencies start as Missing, owned by you.</div>
                  {(template.milestones.length > 0 || template.releases.length > 0) && (
                    <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, cursor: "pointer", color: C.text2 }}>
                      <input type="checkbox" checked={documentsOnly} onChange={(e) => setDocumentsOnly(e.target.checked)} style={{ accentColor: C.indigo }} />
                      Documents and dependencies only, no plan
                    </label>
                  )}
                </>
              ) : (
                "Only the facts entered here; add milestones, governance items, and releases on their own pages."
              )}
            </div>
          </div>
        </div>
      )}
      <div className="vf-fields" style={{ display: "grid", gridTemplateColumns: "1fr 110px", gap: 10 }}>
        <div>
          <Lbl htmlFor="vf-project-name">Name</Lbl>
          <input id="vf-project-name" style={inpStyle} value={d.name} autoFocus={isNew} maxLength={160} placeholder="e.g. KYC refresh automation" onChange={(e) => set({ name: e.target.value })} />
        </div>
        <div>
          <Lbl htmlFor="vf-project-key">Key</Lbl>
          <input id="vf-project-key" style={inpStyle} value={d.key} maxLength={16} onChange={(e) => set({ key: e.target.value })} />
        </div>
      </div>
      {isNew && d.name.trim() !== "" && <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>URL id: {id}</div>}

      <div className="vf-fields" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <Lbl htmlFor="vf-projecteditor-stage">Stage</Lbl>
          <input id="vf-projecteditor-stage" list="vf-stages" style={inpStyle} value={d.stage} onChange={(e) => set({ stage: e.target.value })} />
          <datalist id="vf-stages">
            {STAGES.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
        <div>
          <Lbl htmlFor="vf-projecteditor-ai-risk-tier">AI risk tier</Lbl>
          <select id="vf-projecteditor-ai-risk-tier" style={inpStyle} value={d.tier ?? ""} onChange={(e) => set({ tier: e.target.value === "" ? null : (Number(e.target.value) as RiskTier) })}>
            <option value="">Untiered</option>
            <option value="1">Tier 1 · High risk</option>
            <option value="2">Tier 2 · Medium risk</option>
            <option value="3">Tier 3 · Low risk</option>
          </select>
        </div>
      </div>

      <div className="vf-fields" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <Lbl htmlFor="vf-projecteditor-ai-committee-approval-date">AI committee approval date</Lbl>
          <input id="vf-projecteditor-ai-committee-approval-date"
            style={{ ...inpStyle, borderColor: committeeOk ? C.line2 : C.badLine2 }}
            value={committee.date}
            placeholder="YYYY-MM-DD (blank = pending)"
            onChange={(e) => setCommittee((c) => ({ ...c, date: e.target.value }))}
          />
        </div>
        <div>
          <Lbl htmlFor="vf-projecteditor-committee-reference">Committee reference</Lbl>
          <input id="vf-projecteditor-committee-reference" style={inpStyle} value={committee.ref} placeholder="AIC-2026-…" onChange={(e) => setCommittee((c) => ({ ...c, ref: e.target.value }))} />
        </div>
      </div>

      <Lbl htmlFor="vf-projecteditor-description">Description</Lbl>
      <textarea id="vf-projecteditor-description"
        style={{ ...inpStyle, height: "auto", minHeight: 76, padding: "8px 10px", resize: "vertical", lineHeight: 1.5 }}
        value={d.description}
        onChange={(e) => set({ description: e.target.value })}
      />

      <div className="vf-fields" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <Lbl htmlFor="vf-projecteditor-fte-reduction-target">FTE reduction target (%)</Lbl>
          <input id="vf-projecteditor-fte-reduction-target" type="number" min={0} max={100} step={1} style={{ ...inpStyle, borderColor: pctOk(d.targets.fte) ? C.line2 : C.badLine2 }} value={d.targets.fte} onChange={(e) => set({ targets: { ...d.targets, fte: num(e.target.value) } })} />
        </div>
        <div>
          <Lbl htmlFor="vf-projecteditor-time-reduction-target">Time reduction target (%)</Lbl>
          <input id="vf-projecteditor-time-reduction-target" type="number" min={0} max={100} step={1} style={{ ...inpStyle, borderColor: pctOk(d.targets.time) ? C.line2 : C.badLine2 }} value={d.targets.time} onChange={(e) => set({ targets: { ...d.targets, time: num(e.target.value) } })} />
        </div>
      </div>
      {!targetsOk && <div style={{ fontSize: 11.5, color: C.redHi, marginTop: 4 }}>Targets are percentages between 0 and 100.</div>}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "16px 0 4px" }}>
        <span style={{ fontSize: 12, color: C.mut }}>Team</span>
        <button type="button" onClick={() => setD((x) => ({ ...x, team: [...x.team, { ini: "", name: "", role: "" }] }))} style={{ ...ghostBtn, border: "none", color: C.indigoHi }}>
          + Add member
        </button>
      </div>
      {d.team.length === 0 && <div style={{ fontSize: 12, color: C.dim, padding: "6px 0 2px" }}>No team members yet.</div>}
      {d.team.map((t, i) => (
        <div key={i} className="vf-fields" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 56px 26px", gap: 6, alignItems: "end", marginBottom: 6 }}>
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
            <input style={{ ...inpStyle, borderColor: t.ini === "" || iniOk(t.ini) ? C.line2 : C.badLine2 }} value={t.ini} maxLength={3} aria-label="Initials" onChange={(e) => setTeam(i, { ini: e.target.value.toUpperCase() })} />
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
        <div key={i} className="vf-fields" style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr 26px", gap: 6, alignItems: "end", marginBottom: 6 }}>
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
            <input style={{ ...inpStyle, borderColor: r.url === "" || urlOk(r.url) ? C.line2 : C.badLine2 }} value={r.url} placeholder="github.com/org/repo" onChange={(e) => setRepo(i, { url: e.target.value })} />
          </div>
          <Tip label="Remove repository">
            <button type="button" aria-label="Remove repository" className="vf-ghost" onClick={() => setD((x) => ({ ...x, repos: x.repos.filter((_, ri) => ri !== i) }))} style={removeBtn}>
              ✕
            </button>
          </Tip>
        </div>
      ))}
      {!isNew && templates.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <Lbl htmlFor="vf-follows-template">Follows template</Lbl>
          <select id="vf-follows-template" style={inpStyle} value={d.template?.id ?? ""} onChange={(e) => set({ template: e.target.value ? { id: e.target.value, version: d.template?.id === e.target.value ? d.template.version : null } : null })}>
            <option value="">None</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <div style={{ fontSize: 11.5, color: C.dim, marginTop: 4 }}>The Governance page compares the project's documents and dependencies with this template and can stage what is missing for approval.</div>
        </div>
      )}
      {!isNew && (
        <div style={{ fontSize: 12, color: C.dim, marginTop: 14 }}>Milestones, governance items, and releases are edited on their own pages. Deleting the project removes all of them.</div>
      )}
    </Modal>
  );
}
