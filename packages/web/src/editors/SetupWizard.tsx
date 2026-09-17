import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { GOV_STATUSES, GSTATUS_LABEL, MILESTONE_STATUSES, STATUS_LABEL, initialsOf, monthLabel, nextProjectKey, planningMonths, slugId, templateSummary } from "@valueflow/domain";
import type { Calendar, Confidence, DraftGovernance, DraftMilestone, DraftRelease, GovStatus, MilestoneStatus, Project, ProjectDraft, ProjectTemplate, Repo, RiskTier, SetupDraft, TeamMember } from "@valueflow/domain";
import type { ReleaseInput, SetupCreateInput } from "@valueflow/shared";
import { api } from "../api/client.ts";
import { Btn, Chip, Kbd, Lbl, Modal, Tip, ghostBtn, inpStyle, reset } from "../ui/primitives.tsx";
import { C } from "../theme.ts";
import { DocumentPicker } from "./DocumentPicker.tsx";

// ---- working copy of a draft --------------------------------------------------

interface Working {
  description: string;
  stage: string;
  tier: RiskTier | null;
  committee: { date: string; ref: string };
  targets: { fte: number; time: number };
  team: TeamMember[];
  repos: Repo[];
  milestones: DraftMilestone[];
  governance: DraftGovernance[];
  releases: DraftRelease[];
}

export const fromDraft = (d: ProjectDraft): Working => ({
  description: d.description.value,
  stage: d.stage.value,
  tier: d.tier.value,
  committee: { date: d.committee.value?.date ?? "", ref: d.committee.value?.ref ?? "" },
  targets: { ...d.targets.value },
  team: d.team.map((t) => ({ ...t.value })),
  repos: d.repos.map((r) => ({ ...r.value })),
  milestones: d.milestones.map((m) => structuredClone(m.value)),
  governance: d.governance.map((g) => ({ ...g.value })),
  releases: d.releases.map((r) => structuredClone(r.value)),
});

const CONF_COLOR: Record<Confidence, string> = { high: C.green, medium: C.amber, low: C.dim };
const STAGES = ["Discovery", "Pilot", "Scaling", "Sustain"];
const small = { ...inpStyle, height: 28, fontSize: 12.5, padding: "0 8px" } as const;
const num = (v: string): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Rationale, source, and confidence under a suggestion. */
function Why({ s }: { s: { rationale: string; source: string | null; confidence: Confidence } }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 11, color: C.dim, marginTop: 4, lineHeight: 1.45 }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: CONF_COLOR[s.confidence] }} />
        {s.confidence}
      </span>
      {s.source && <span style={{ flexShrink: 0, color: C.mut }}>{s.source}</span>}
      <span>{s.rationale}</span>
    </div>
  );
}

/** A reviewable row: include toggle, editor, and the agent's reasoning. */
function Row({ path, label, excluded, onToggle, why, children }: { path: string; label?: string; excluded: Set<string>; onToggle: (p: string) => void; why: { rationale: string; source: string | null; confidence: Confidence }; children: ReactNode }) {
  const off = excluded.has(path);
  return (
    <div style={{ display: "flex", gap: 10, padding: "10px 0", borderTop: `1px solid ${C.line}`, opacity: off ? 0.45 : 1 }}>
      <Tip label={off ? "Excluded — click to include" : "Included — click to exclude"}>
        <input type="checkbox" checked={!off} onChange={() => onToggle(path)} style={{ accentColor: C.indigo, marginTop: 6, cursor: "pointer" }} aria-label={`Include ${label ?? path}`} />
      </Tip>
      <div style={{ flex: 1, minWidth: 0 }}>
        {label && <div style={{ fontSize: 12, color: C.mut, marginBottom: 4 }}>{label}</div>}
        {children}
        <Why s={why} />
      </div>
    </div>
  );
}

function Section({ title, count, right, children }: { title: string; count?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
        <span style={{ fontSize: 13, fontWeight: 550, color: C.text, letterSpacing: "-0.01em" }}>{title}</span>
        {count && <span style={{ fontSize: 11, color: C.dim }}>{count}</span>}
        <span style={{ flex: 1 }} />
        {right}
      </div>
      {children}
    </div>
  );
}

// ---- compose the create payload ------------------------------------------------

export const compose = (name: string, key: string, w: Working, excluded: Set<string>, existingIds: string[], defaultOwner: string): SetupCreateInput => {
  const inc = (path: string) => !excluded.has(path);
  const team = w.team.filter((_, i) => inc(`team.${i}`)).map((t) => ({ ini: (t.ini || initialsOf(t.name)).toUpperCase().slice(0, 3), name: t.name.trim(), role: t.role.trim() || "Team member" }));
  const iniFor = (owner: string): string => {
    const o = owner.trim();
    if (/^[A-Za-z]{1,3}$/.test(o)) return o.toUpperCase();
    const hit = team.find((t) => t.name.toLowerCase() === o.toLowerCase());
    return hit ? hit.ini : o ? initialsOf(o) : defaultOwner;
  };
  const milestones = w.milestones.filter((_, i) => inc(`milestones.${i}`));
  const msIds = new Map(milestones.map((m, i) => [m.name, `MS-${i + 1}`]));
  const governance = w.governance.filter((_, i) => inc(`governance.${i}`));
  const govIds: string[] = [];
  const gidFor = new Map<string, string>();
  for (const g of governance) {
    const id = slugId(g.name, govIds, "item");
    govIds.push(id);
    gidFor.set(g.name, id);
  }
  return {
    project: {
      id: slugId(name, existingIds, "project"),
      key: key.trim(),
      name: name.trim(),
      stage: inc("stage") ? w.stage.trim() || "Discovery" : "Discovery",
      description: inc("description") ? w.description.trim() : "",
      tier: inc("tier") ? w.tier : null,
      committee: inc("committee") && /^\d{4}-\d{2}-\d{2}$/.test(w.committee.date) && w.committee.ref.trim() ? { date: w.committee.date, ref: w.committee.ref.trim() } : null,
      repos: w.repos.filter((_, i) => inc(`repos.${i}`)).map((r) => ({ name: r.name.trim(), url: r.url.trim() || `github.com/org/${r.name.trim()}` })),
      team,
      targets: inc("targets") ? { fte: w.targets.fte, time: w.targets.time } : { fte: 30, time: 30 },
    },
    milestones: milestones.map((m, i) => ({
      id: `MS-${i + 1}`,
      name: m.name.trim(),
      status: m.status,
      month: m.month,
      impact: m.impact,
      metrics: m.metrics.filter((x) => x.label.trim()).map((x, xi) => ({ id: slugId(x.label, [], `m${xi + 1}`).slice(0, 24), label: x.label.trim(), base: x.base, stretch: x.stretch, current: 0 })),
    })),
    governance: governance.map((g, i) => ({ id: govIds[i] ?? slugId(g.name, [], "item"), cat: g.cat.trim() || "Governance", name: g.name.trim(), status: g.status, owner: iniFor(g.owner), date: null, detail: g.detail.trim() })),
    releases: w.releases
      .filter((_, i) => inc(`releases.${i}`))
      .map((r, i) => ({
        id: `R${i + 1}`,
        name: r.name.trim(),
        month: r.month,
        milestoneIds: r.milestones.map((n) => msIds.get(n)).filter((x): x is string => x !== undefined),
        criteria: r.criteria.flatMap((c): ReleaseInput["criteria"] => {
          if (c.type === "gate") {
            const ms = msIds.get(c.ref);
            return ms ? [{ type: "gate" as const, ms, label: c.label }] : [];
          }
          if (c.type === "gov") {
            const gid = gidFor.get(c.ref);
            return gid ? [{ type: "gov" as const, gid, label: c.label }] : [];
          }
          return [{ type: "manual" as const, ok: false, label: c.label }];
        }),
      })),
  };
};

// ---- the wizard ------------------------------------------------------------------

export function SetupWizard({ projects, templates = [], cal, defaultOwner, onCreated, onClose }: { projects: Project[]; templates?: ProjectTemplate[]; cal: Calendar; defaultOwner: string; onCreated: (pid: string) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const [key, setKey] = useState(nextProjectKey(projects));
  const [templateId, setTemplateId] = useState<string>(templates[0]?.id ?? "");
  const template = templates.find((t) => t.id === templateId) ?? null;
  const [brief, setBrief] = useState("");
  const [snippets, setSnippets] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<SetupDraft | null>(null);
  const [w, setW] = useState<Working | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [edited, setEdited] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState("");
  const months = useMemo(() => planningMonths(cal, 18), [cal]);

  const toggle = (p: string) =>
    setExcluded((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });
  const touch = (p: string) => setEdited((s) => new Set(s).add(p));
  const patch = (p: string, fn: (x: Working) => Working) => {
    touch(p);
    setW((x) => (x ? fn(x) : x));
  };

  const analyze = async () => {
    setBusy(`Reading ${files.length + snippets.filter((s) => s.trim()).length} source${files.length + snippets.length === 1 ? "" : "s"} and drafting the project…`);
    setError(null);
    try {
      const form = new FormData();
      form.set("name", name.trim());
      form.set("key", key.trim());
      form.set("brief", brief);
      if (template) form.set("template", template.id);
      for (const s of snippets) if (s.trim()) form.append("snippet", s);
      for (const f of files) form.append("file", f, f.name);
      const d = await api.setupAnalyze(form);
      setDraft(d);
      setW(fromDraft(d.draft));
      setExcluded(new Set(["committee"]));
      setEdited(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const refine = async () => {
    if (!draft || !feedback.trim()) return;
    setBusy("Applying your feedback…");
    setError(null);
    try {
      const d = await api.setupRefine(draft.id, feedback.trim());
      const fresh = fromDraft(d.draft);
      // Keep anything the reviewer already edited; take the agent's new value elsewhere.
      setW((prev) => {
        if (!prev) return fresh;
        const next: Working = { ...fresh };
        if (edited.has("description")) next.description = prev.description;
        if (edited.has("stage")) next.stage = prev.stage;
        if (edited.has("tier")) next.tier = prev.tier;
        if (edited.has("committee")) next.committee = prev.committee;
        if (edited.has("targets")) next.targets = prev.targets;
        for (const list of ["team", "repos", "milestones", "governance", "releases"] as const) {
          const merged = [...(fresh[list] as unknown[])];
          (prev[list] as unknown[]).forEach((item, i) => {
            if (edited.has(`${list}.${i}`)) merged[i] = item;
          });
          (next as unknown as Record<string, unknown>)[list] = merged;
        }
        return next;
      });
      setDraft(d);
      setFeedback("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const create = async () => {
    if (!draft || !w) return;
    setBusy("Creating the project…");
    setError(null);
    try {
      const input = compose(name, key, w, excluded, projects.map((p) => p.id), defaultOwner);
      const p = await api.setupCreate(draft.id, input);
      onCreated(p.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  const canAnalyze = name.trim() !== "" && key.trim() !== "" && key.trim().length <= 16 && !busy;
  const included = (list: keyof Working, n: number) => Array.from({ length: n }, (_, i) => `${list}.${i}`).filter((p) => !excluded.has(p)).length;

  // ---- step 1: sources ----------------------------------------------------------
  if (!draft || !w) {
    return (
      <Modal
        title="Set up a project from documents"
        onClose={onClose}
        onSubmit={canAnalyze ? analyze : undefined}
        width={720}
        footer={
          <>
            <Btn onClick={onClose}>Cancel</Btn>
            <Btn tone="primary" disabled={!canAnalyze} onClick={() => void analyze()}>
              {busy ? "Working…" : "Draft the project"}
            </Btn>
          </>
        }
      >
        <div style={{ fontSize: 12, color: C.mut, lineHeight: 1.55, marginTop: 8 }}>
          Give the setup agent a name and anything you have: a charter, a deck, meeting notes, a pasted email. It drafts every field of the project record with a
          rationale and a confidence, and you decide what to keep. Nothing is created until you confirm.
        </div>
        <div className="vf-fields" style={{ display: "grid", gridTemplateColumns: "1fr 110px", gap: 10 }}>
          <div>
            <Lbl htmlFor="vf-setupwizard-project-name">Project name</Lbl>
            <input id="vf-setupwizard-project-name" style={inpStyle} value={name} autoFocus maxLength={160} placeholder="e.g. KYC refresh automation" onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Lbl htmlFor="vf-setupwizard-key">Key</Lbl>
            <input id="vf-setupwizard-key" style={inpStyle} value={key} maxLength={16} onChange={(e) => setKey(e.target.value)} />
          </div>
        </div>
        {templates.length > 0 && (
          <div className="vf-fields" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, alignItems: "end" }}>
            <div>
              <Lbl htmlFor="vf-setup-template">Template</Lbl>
              <select id="vf-setup-template" style={inpStyle} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                <option value="">None — only what the documents say</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div style={{ fontSize: 11.5, color: C.dim, lineHeight: 1.5, paddingBottom: 6 }}>
              {template ? `The draft will carry the template's base set (${templateSummary(template)}); anything the documents do not mention is added as Missing for you to keep or drop.` : "The draft carries only what the documents support."}
            </div>
          </div>
        )}
        <Lbl htmlFor="vf-setupwizard-brief-optional">Brief (optional)</Lbl>
        <textarea id="vf-setupwizard-brief-optional"
          style={{ ...inpStyle, height: "auto", minHeight: 64, padding: "8px 10px", resize: "vertical", lineHeight: 1.5 }}
          value={brief}
          placeholder="A sentence or two on what the project does and why it matters."
          onChange={(e) => setBrief(e.target.value)}
        />
        <Lbl>Documents</Lbl>
        <DocumentPicker files={files} snippets={snippets} onFiles={setFiles} onSnippets={setSnippets} />
        {busy && (
          <div style={{ fontSize: 12.5, color: C.indigoHi, marginTop: 12 }} className="vf-pulse">
            {busy}
          </div>
        )}
        {error && <div style={{ fontSize: 12.5, color: C.redHi, marginTop: 12 }}>{error}</div>}
      </Modal>
    );
  }

  // ---- step 2: review ------------------------------------------------------------
  const d = draft.draft;
  const includedMilestoneNames = w.milestones.filter((_, i) => !excluded.has(`milestones.${i}`)).map((m) => m.name);
  const includedGovNames = w.governance.filter((_, i) => !excluded.has(`governance.${i}`)).map((g) => g.name);
  const usable = draft.sources.filter((s) => !s.error);
  const failed = draft.sources.filter((s) => s.error);

  return (
    <Modal
      title={`Review the draft — ${draft.name}`}
      onClose={onClose}
      width={900}
      footer={
        <>
          <span style={{ marginRight: "auto", fontSize: 12, color: C.dim }}>
            {included("milestones", w.milestones.length)} milestones · {included("governance", w.governance.length)} governance items · {included("releases", w.releases.length)} releases · {included("team", w.team.length)} people
          </span>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn tone="primary" disabled={!!busy} onClick={() => void create()}>
            {busy === "Creating the project…" ? "Creating…" : "Create project"}
          </Btn>
        </>
      }
    >
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "8px 0 4px", fontSize: 12, color: C.dim }}>
        <span>Drafted by {draft.model ?? "the setup agent"} from</span>
        {usable.map((s) => (
          <Chip key={s.name}>
            {s.name} · {s.kind}
          </Chip>
        ))}
        {failed.map((s) => (
          <Tip key={s.name} label={s.error ?? "unusable"}>
            <Chip tone="bad">{s.name} · skipped</Chip>
          </Tip>
        ))}
      </div>
      <div style={{ fontSize: 12, color: C.mut, lineHeight: 1.5 }}>
        Committee approval is excluded until you explicitly confirm its evidence. Untick anything you do not want, edit anything that is off, or tell the agent what to change below. Colours show how sure it was: <span style={{ color: C.green }}>high</span>,{" "}
        <span style={{ color: C.amber }}>medium</span>, <span style={{ color: C.dim }}>low</span>.
      </div>
      {d.notes.length > 0 && (
        <div style={{ marginTop: 10, background: C.inset, border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 12px", fontSize: 12, color: C.mut, lineHeight: 1.55 }}>
          <div style={{ color: C.dim, marginBottom: 2 }}>Open questions from the documents</div>
          {d.notes.map((n, i) => (
            <div key={i}>• {n}</div>
          ))}
        </div>
      )}

      <Section title="Basics">
        <Row path="description" label="Description" excluded={excluded} onToggle={toggle} why={d.description}>
          <textarea style={{ ...inpStyle, height: "auto", minHeight: 56, padding: "6px 10px", resize: "vertical", lineHeight: 1.5, fontSize: 12.5 }} value={w.description} onChange={(e) => patch("description", (x) => ({ ...x, description: e.target.value }))} />
        </Row>
        <div className="vf-fields" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Row path="stage" label="Stage" excluded={excluded} onToggle={toggle} why={d.stage}>
            <select style={small} value={w.stage} onChange={(e) => patch("stage", (x) => ({ ...x, stage: e.target.value }))}>
              {[...new Set([...STAGES, w.stage])].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Row>
          <Row path="tier" label="AI risk tier" excluded={excluded} onToggle={toggle} why={d.tier}>
            <select style={small} value={w.tier ?? ""} onChange={(e) => patch("tier", (x) => ({ ...x, tier: e.target.value === "" ? null : (Number(e.target.value) as RiskTier) }))}>
              <option value="">Untiered</option>
              <option value="1">Tier 1 · High risk</option>
              <option value="2">Tier 2 · Medium risk</option>
              <option value="3">Tier 3 · Low risk</option>
            </select>
          </Row>
        </div>
        <div className="vf-fields" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Row path="targets" label="Targets (% reduction)" excluded={excluded} onToggle={toggle} why={d.targets}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, color: C.dim }}>
              FTE <input type="number" style={{ ...small, width: 70 }} value={w.targets.fte} onChange={(e) => patch("targets", (x) => ({ ...x, targets: { ...x.targets, fte: num(e.target.value) } }))} />
              time <input type="number" style={{ ...small, width: 70 }} value={w.targets.time} onChange={(e) => patch("targets", (x) => ({ ...x, targets: { ...x.targets, time: num(e.target.value) } }))} />
            </div>
          </Row>
          <Row path="committee" label="AI committee approval" excluded={excluded} onToggle={toggle} why={d.committee}>
            <div style={{ display: "flex", gap: 6 }}>
              <input style={{ ...small, width: 110 }} placeholder="YYYY-MM-DD" value={w.committee.date} onChange={(e) => patch("committee", (x) => ({ ...x, committee: { ...x.committee, date: e.target.value } }))} />
              <input style={small} placeholder="reference (blank = pending)" value={w.committee.ref} onChange={(e) => patch("committee", (x) => ({ ...x, committee: { ...x.committee, ref: e.target.value } }))} />
            </div>
          </Row>
        </div>
      </Section>

      <Section title="Team" count={`${included("team", w.team.length)} of ${w.team.length}`}>
        {w.team.length === 0 && <div style={{ fontSize: 12, color: C.dim, padding: "8px 0" }}>Nobody named in the documents. You can add people on the Overview tab later.</div>}
        {w.team.map((t, i) => (
          <Row key={i} path={`team.${i}`} excluded={excluded} onToggle={toggle} why={d.team[i] ?? { rationale: "", source: null, confidence: "low" }}>
            <div className="vf-fields" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 60px", gap: 6 }}>
              <input style={small} value={t.name} onChange={(e) => patch(`team.${i}`, (x) => ({ ...x, team: x.team.map((y, yi) => (yi === i ? { ...y, name: e.target.value, ini: initialsOf(e.target.value) } : y)) }))} />
              <input style={small} value={t.role} onChange={(e) => patch(`team.${i}`, (x) => ({ ...x, team: x.team.map((y, yi) => (yi === i ? { ...y, role: e.target.value } : y)) }))} />
              <input style={small} value={t.ini} maxLength={3} onChange={(e) => patch(`team.${i}`, (x) => ({ ...x, team: x.team.map((y, yi) => (yi === i ? { ...y, ini: e.target.value.toUpperCase() } : y)) }))} />
            </div>
          </Row>
        ))}
      </Section>

      <Section title="Repositories" count={`${included("repos", w.repos.length)} of ${w.repos.length}`}>
        {w.repos.length === 0 && <div style={{ fontSize: 12, color: C.dim, padding: "8px 0" }}>No repositories named in the documents.</div>}
        {w.repos.map((r, i) => (
          <Row key={i} path={`repos.${i}`} excluded={excluded} onToggle={toggle} why={d.repos[i] ?? { rationale: "", source: null, confidence: "low" }}>
            <div className="vf-fields" style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 6 }}>
              <input style={small} value={r.name} onChange={(e) => patch(`repos.${i}`, (x) => ({ ...x, repos: x.repos.map((y, yi) => (yi === i ? { ...y, name: e.target.value } : y)) }))} />
              <input style={small} value={r.url} onChange={(e) => patch(`repos.${i}`, (x) => ({ ...x, repos: x.repos.map((y, yi) => (yi === i ? { ...y, url: e.target.value } : y)) }))} />
            </div>
          </Row>
        ))}
      </Section>

      <Section title="Milestones" count={`${included("milestones", w.milestones.length)} of ${w.milestones.length}`}>
        {w.milestones.map((m, i) => {
          const set = (fn: (m: DraftMilestone) => DraftMilestone) => patch(`milestones.${i}`, (x) => ({ ...x, milestones: x.milestones.map((y, yi) => (yi === i ? fn(y) : y)) }));
          return (
            <Row key={i} path={`milestones.${i}`} excluded={excluded} onToggle={toggle} why={d.milestones[i] ?? { rationale: "", source: null, confidence: "low" }}>
              <div className="vf-fields" style={{ display: "grid", gridTemplateColumns: "2fr 120px 110px", gap: 6, marginBottom: 6 }}>
                <input style={small} value={m.name} onChange={(e) => set((y) => ({ ...y, name: e.target.value }))} />
                <select style={small} value={m.status} onChange={(e) => set((y) => ({ ...y, status: e.target.value as MilestoneStatus }))}>
                  {MILESTONE_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
                <select style={small} value={m.month} onChange={(e) => set((y) => ({ ...y, month: e.target.value }))}>
                  {!months.includes(m.month) && <option value={m.month}>{m.month}</option>}
                  {months.map((mo) => (
                    <option key={mo} value={mo}>
                      {monthLabel(mo, cal.todayYm)}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11, color: C.dim, flexWrap: "wrap" }}>
                <span>base</span>
                <input type="number" style={{ ...small, width: 56 }} value={m.impact.base.fte} onChange={(e) => set((y) => ({ ...y, impact: { ...y.impact, base: { ...y.impact.base, fte: num(e.target.value) } } }))} />
                <span>% FTE</span>
                <input type="number" style={{ ...small, width: 56 }} value={m.impact.base.time} onChange={(e) => set((y) => ({ ...y, impact: { ...y.impact, base: { ...y.impact.base, time: num(e.target.value) } } }))} />
                <span>% time · stretch</span>
                <input type="number" style={{ ...small, width: 56 }} value={m.impact.stretch.fte} onChange={(e) => set((y) => ({ ...y, impact: { ...y.impact, stretch: { ...y.impact.stretch, fte: num(e.target.value) } } }))} />
                <span>% FTE</span>
                <input type="number" style={{ ...small, width: 56 }} value={m.impact.stretch.time} onChange={(e) => set((y) => ({ ...y, impact: { ...y.impact, stretch: { ...y.impact.stretch, time: num(e.target.value) } } }))} />
                <span>% time</span>
              </div>
              <div style={{ marginTop: 6 }}>
                {m.metrics.map((x, xi) => (
                  <div key={xi} className="vf-fields" style={{ display: "grid", gridTemplateColumns: "1fr 70px 70px 26px", gap: 6, marginBottom: 4, alignItems: "center", fontSize: 11 }}>
                    <input style={small} value={x.label} placeholder="metric" onChange={(e) => set((y) => ({ ...y, metrics: y.metrics.map((z, zi) => (zi === xi ? { ...z, label: e.target.value } : z)) }))} />
                    <input type="number" style={small} value={x.base} title="base gate %" onChange={(e) => set((y) => ({ ...y, metrics: y.metrics.map((z, zi) => (zi === xi ? { ...z, base: num(e.target.value) } : z)) }))} />
                    <input type="number" style={small} value={x.stretch} title="stretch gate %" onChange={(e) => set((y) => ({ ...y, metrics: y.metrics.map((z, zi) => (zi === xi ? { ...z, stretch: num(e.target.value) } : z)) }))} />
                    <button type="button" aria-label="Remove metric" onClick={() => set((y) => ({ ...y, metrics: y.metrics.filter((_, zi) => zi !== xi) }))} style={{ ...reset, color: C.dim, textAlign: "center" }}>
                      ✕
                    </button>
                  </div>
                ))}
                <button type="button" onClick={() => set((y) => ({ ...y, metrics: [...y.metrics, { label: "", base: 80, stretch: 95 }] }))} style={{ ...ghostBtn, border: "none", color: C.indigoHi, height: 22, padding: 0 }}>
                  + Add gate metric
                </button>
              </div>
            </Row>
          );
        })}
      </Section>

      <Section title="Governance" count={`${included("governance", w.governance.length)} of ${w.governance.length}`}>
        {w.governance.map((g, i) => {
          const set = (fn: (g: DraftGovernance) => DraftGovernance) => patch(`governance.${i}`, (x) => ({ ...x, governance: x.governance.map((y, yi) => (yi === i ? fn(y) : y)) }));
          return (
            <Row key={i} path={`governance.${i}`} excluded={excluded} onToggle={toggle} why={d.governance[i] ?? { rationale: "", source: null, confidence: "low" }}>
              <div className="vf-fields" style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 110px 120px", gap: 6 }}>
                <input style={small} value={g.name} onChange={(e) => set((y) => ({ ...y, name: e.target.value }))} />
                <input style={small} value={g.cat} list="vf-setup-cats" onChange={(e) => set((y) => ({ ...y, cat: e.target.value }))} />
                <select style={small} value={g.status} onChange={(e) => set((y) => ({ ...y, status: e.target.value as GovStatus }))}>
                  {GOV_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {GSTATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
                <input style={small} value={g.owner} placeholder="owner" onChange={(e) => set((y) => ({ ...y, owner: e.target.value }))} />
              </div>
              {g.detail && <div style={{ fontSize: 11.5, color: C.mut, marginTop: 4 }}>{g.detail}</div>}
            </Row>
          );
        })}
        <datalist id="vf-setup-cats">
          {["Design & architecture", "AI governance", "Operations", "Release & adoption", "Dependencies"].map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </Section>

      <Section title="Releases" count={`${included("releases", w.releases.length)} of ${w.releases.length}`}>
        {w.releases.map((r, i) => {
          const set = (fn: (r: DraftRelease) => DraftRelease) => patch(`releases.${i}`, (x) => ({ ...x, releases: x.releases.map((y, yi) => (yi === i ? fn(y) : y)) }));
          return (
            <Row key={i} path={`releases.${i}`} excluded={excluded} onToggle={toggle} why={d.releases[i] ?? { rationale: "", source: null, confidence: "low" }}>
              <div className="vf-fields" style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 6, marginBottom: 6 }}>
                <input style={small} value={r.name} onChange={(e) => set((y) => ({ ...y, name: e.target.value }))} />
                <select style={small} value={r.month} onChange={(e) => set((y) => ({ ...y, month: e.target.value }))}>
                  {!months.includes(r.month) && <option value={r.month}>{r.month}</option>}
                  {months.map((mo) => (
                    <option key={mo} value={mo}>
                      {monthLabel(mo, cal.todayYm)}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
                {includedMilestoneNames.map((n) => {
                  const on = r.milestones.includes(n);
                  return (
                    <button key={n} type="button" aria-pressed={on} onClick={() => set((y) => ({ ...y, milestones: on ? y.milestones.filter((m) => m !== n) : [...y.milestones, n] }))} style={{ ...ghostBtn, height: 24, fontSize: 11.5, color: on ? C.text : C.mut, background: on ? C.accentSoft2 : "transparent", borderColor: on ? C.accentLine2 : C.line2 }}>
                      {n}
                    </button>
                  );
                })}
              </div>
              {r.criteria.map((c, ci) => (
                <div key={ci} className="vf-fields" style={{ display: "grid", gridTemplateColumns: "90px 1fr 1.2fr 26px", gap: 6, marginBottom: 4 }}>
                  <select style={small} value={c.type} onChange={(e) => set((y) => ({ ...y, criteria: y.criteria.map((z, zi) => (zi === ci ? { ...z, type: e.target.value as "gate" | "gov" | "manual", ref: "" } : z)) }))}>
                    <option value="gate">Gate</option>
                    <option value="gov">Governance</option>
                    <option value="manual">Manual</option>
                  </select>
                  {c.type === "manual" ? (
                    <span style={{ fontSize: 11.5, color: C.dim, alignSelf: "center" }}>sign-off, unconfirmed</span>
                  ) : (
                    <select style={small} value={c.ref} onChange={(e) => set((y) => ({ ...y, criteria: y.criteria.map((z, zi) => (zi === ci ? { ...z, ref: e.target.value } : z)) }))}>
                      {!(c.type === "gate" ? includedMilestoneNames : includedGovNames).includes(c.ref) && <option value={c.ref}>{c.ref || "choose…"} (not included)</option>}
                      {(c.type === "gate" ? includedMilestoneNames : includedGovNames).map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  )}
                  <input style={small} value={c.label} onChange={(e) => set((y) => ({ ...y, criteria: y.criteria.map((z, zi) => (zi === ci ? { ...z, label: e.target.value } : z)) }))} />
                  <button type="button" aria-label="Remove criterion" onClick={() => set((y) => ({ ...y, criteria: y.criteria.filter((_, zi) => zi !== ci) }))} style={{ ...reset, color: C.dim, textAlign: "center" }}>
                    ✕
                  </button>
                </div>
              ))}
              <button type="button" onClick={() => set((y) => ({ ...y, criteria: [...y.criteria, { type: "manual", ref: "", label: "" }] }))} style={{ ...ghostBtn, border: "none", color: C.indigoHi, height: 22, padding: 0 }}>
                + Add criterion
              </button>
            </Row>
          );
        })}
      </Section>

      <Section title="Ask the agent to change something">
        <div className="vf-fields" style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 8, alignItems: "start", paddingTop: 6 }}>
          <textarea
            style={{ ...inpStyle, height: "auto", minHeight: 56, padding: "8px 10px", resize: "vertical", lineHeight: 1.5, fontSize: 12.5 }}
            value={feedback}
            placeholder="e.g. Split the pilot into two releases, make the tier 1, and add an SRE runbook item owned by Priya."
            onChange={(e) => setFeedback(e.target.value)}
          />
          <Btn disabled={!feedback.trim() || !!busy} onClick={() => void refine()}>
            {busy === "Applying your feedback…" ? "Working…" : "Refine draft"}
          </Btn>
        </div>
        {draft.feedback.length > 0 && (
          <div style={{ fontSize: 11.5, color: C.dim, marginTop: 6 }}>
            Applied so far: {draft.feedback.map((f, i) => `${i + 1}. ${f}`).join("  ")}
          </div>
        )}
        <div style={{ fontSize: 11.5, color: C.dim, marginTop: 8 }}>
          Rows you have edited keep your edits when the draft is refined. <Kbd>⌘</Kbd> <Kbd>↵</Kbd> is not bound here so a stray keypress cannot create the project.
        </div>
        {busy && busy !== "Creating the project…" && (
          <div style={{ fontSize: 12.5, color: C.indigoHi, marginTop: 10 }} className="vf-pulse">
            {busy}
          </div>
        )}
        {error && <div style={{ fontSize: 12.5, color: C.redHi, marginTop: 10 }}>{error}</div>}
      </Section>
    </Modal>
  );
}
