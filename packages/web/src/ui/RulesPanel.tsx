import { useState } from "react";
import {
  AUTONOMY_MIN_DECISIONS,
  AUTONOMY_MIN_RATE,
  ruleStats,
} from "@valueflow/domain";
import type { Project, Proposal, Rule } from "@valueflow/domain";
import type { RuleInput } from "@valueflow/shared";
import {
  Btn,
  Chip,
  Lbl,
  ListRow,
  Modal,
  SectionCard,
  Tip,
  ghostBtn,
  inpStyle,
} from "./primitives.tsx";
import { C } from "../theme.ts";

const pct = (v: number | null) =>
  v === null ? "—" : `${Math.round(v * 100)}%`;

/** Write or edit one standing rule in plain language. */
function RuleEditor({
  rule,
  projects,
  defaultOwner,
  onSave,
  onDelete,
  onClose,
}: {
  rule: Rule | null;
  projects: Project[];
  defaultOwner: string;
  onSave: (input: RuleInput) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(rule?.text ?? "");
  const [proj, setProj] = useState<string>(rule?.proj ?? "");
  const [owner, setOwner] = useState(rule?.owner ?? defaultOwner);
  const valid = text.trim().length >= 12 && owner.trim().length > 0;
  const submit = () => {
    if (!valid) return;
    onSave({
      text: text.trim(),
      proj: proj || null,
      enabled: rule?.enabled ?? true,
      auto: rule?.auto ?? false,
      owner: owner.trim().toUpperCase().slice(0, 3),
    });
  };
  return (
    <Modal
      title={rule ? "Edit rule" : "New standing rule"}
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          {rule && (
            <Btn tone="danger" onClick={onDelete}>
              Delete
            </Btn>
          )}
          <span style={{ flex: 1 }} />
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn tone="primary" disabled={!valid} onClick={submit}>
            {rule ? "Save" : "Add rule"}
          </Btn>
        </>
      }
    >
      <div
        style={{ fontSize: 12, color: C.mut, lineHeight: 1.55, marginTop: 8 }}
      >
        Say what should happen when a condition holds, in plain language. Sentry
        checks it against each project's live state every night and turns what
        the rule asks for into proposals. Ask it to "flag me" when a person
        should look.
      </div>
      <Lbl>Rule</Lbl>
      <textarea
        style={{
          ...inpStyle,
          height: "auto",
          minHeight: 88,
          padding: "8px 10px",
          resize: "vertical",
          lineHeight: 1.5,
        }}
        value={text}
        autoFocus
        placeholder="If a Tier 1 project has a failing build for more than two days, add a calendar event for a fix-by decision and flag me."
        onChange={(e) => setText(e.target.value)}
      />
      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 110px", gap: 10 }}
      >
        <div>
          <Lbl>Applies to</Lbl>
          <select
            style={inpStyle}
            value={proj}
            onChange={(e) => setProj(e.target.value)}
          >
            <option value="">Every project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Lbl>Owner</Lbl>
          <input
            style={inpStyle}
            value={owner}
            maxLength={3}
            onChange={(e) => setOwner(e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}

/**
 * Standing rules: what a person wrote, how often each has fired, and how its
 * proposals were received. A rule that people keep accepting can be trusted
 * to apply on its own; that switch is the person's, and stays visible.
 */
export function RulesPanel({
  rules,
  proposals,
  projects,
  defaultOwner,
  canRun,
  onSave,
  onDelete,
  onRunNow,
}: {
  rules: Rule[];
  proposals: Proposal[];
  projects: Project[];
  defaultOwner: string;
  canRun: boolean;
  onSave: (rule: Rule | null, input: RuleInput) => void;
  onDelete: (id: string) => void;
  onRunNow: () => void;
}) {
  const [editing, setEditing] = useState<Rule | null | "new">(null);
  const projectName = (id: string | null) =>
    id === null
      ? "every project"
      : (projects.find((p) => p.id === id)?.name ?? id);
  const toggle = (r: Rule, patch: Partial<Pick<Rule, "enabled" | "auto">>) =>
    onSave(r, {
      text: r.text,
      proj: r.proj,
      enabled: r.enabled,
      auto: r.auto,
      owner: r.owner,
      ...patch,
    });
  return (
    <SectionCard
      title="Standing rules"
      pad="4px 26px 6px"
      right={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span className="vf-hint" style={{ fontSize: 11, color: C.dim }}>
            checked nightly by Sentry · a rule earns autonomy after{" "}
            {AUTONOMY_MIN_DECISIONS} decisions at ≥
            {Math.round(AUTONOMY_MIN_RATE * 100)}% accepted
          </span>
          <button
            type="button"
            className="vf-ghost"
            disabled={!canRun || !rules.some((r) => r.enabled)}
            onClick={onRunNow}
            style={{
              ...ghostBtn,
              height: 24,
              opacity: canRun && rules.some((r) => r.enabled) ? 1 : 0.5,
            }}
          >
            Check now
          </button>
          <button
            type="button"
            className="vf-ghost"
            onClick={() => setEditing("new")}
            style={{ ...ghostBtn, height: 24, color: C.indigoHi }}
          >
            + New rule
          </button>
        </span>
      }
    >
      {rules.length === 0 && (
        <div style={{ fontSize: 12, color: C.dim, padding: "12px 0" }}>
          No standing rules yet. Write one and Sentry will check it against
          every project each night.
        </div>
      )}
      {rules.map((r, i) => {
        const st = ruleStats(r, proposals);
        return (
          <ListRow
            key={r.id}
            first={i === 0}
            muted={!r.enabled}
            onClick={() => setEditing(r)}
            title={r.text}
            sub={`${r.id.replace("rule-", "#")} · ${projectName(r.proj)} · owner ${r.owner} · fired ${st.fired}×${st.fired ? ` · accepted ${pct(st.acceptanceRate)} of ${st.accepted + st.dismissed} decided${st.pending ? `, ${st.pending} pending` : ""}` : ""}`}
            right={
              <>
                {r.auto ? (
                  <Chip tone="good" dot>
                    applies on its own
                  </Chip>
                ) : st.earnedAutonomy ? (
                  <Tip
                    label={`${st.accepted} of ${st.accepted + st.dismissed} proposals accepted. Let this rule apply its proposals without waiting.`}
                  >
                    <button
                      type="button"
                      className="vf-ghost"
                      onClick={() => toggle(r, { auto: true })}
                      style={{
                        ...ghostBtn,
                        height: 24,
                        color: C.green,
                        borderColor: C.goodLine2,
                      }}
                    >
                      Earned autonomy · turn on
                    </button>
                  </Tip>
                ) : null}
                {r.auto && (
                  <button
                    type="button"
                    className="vf-ghost"
                    onClick={() => toggle(r, { auto: false })}
                    style={{ ...ghostBtn, height: 24 }}
                  >
                    Ask me again
                  </button>
                )}
                <button
                  type="button"
                  className="vf-ghost"
                  onClick={() => toggle(r, { enabled: !r.enabled })}
                  style={{ ...ghostBtn, height: 24 }}
                >
                  {r.enabled ? "Disable" : "Enable"}
                </button>
              </>
            }
          />
        );
      })}
      {editing !== null && (
        <RuleEditor
          rule={editing === "new" ? null : editing}
          projects={projects}
          defaultOwner={defaultOwner}
          onSave={(input) => {
            onSave(editing === "new" ? null : editing, input);
            setEditing(null);
          }}
          onDelete={() => {
            if (editing !== "new") onDelete(editing.id);
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </SectionCard>
  );
}
