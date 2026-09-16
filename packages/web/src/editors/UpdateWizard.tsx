import { useState } from "react";
import { describeAction } from "@valueflow/domain";
import type { AgentRun, AppState, Project, Proposal, SetupSource } from "@valueflow/domain";
import { api } from "../api/client.ts";
import { Btn, Chip, Lbl, Modal, Tip, inpStyle } from "../ui/primitives.tsx";
import { C } from "../theme.ts";
import { DocumentPicker } from "./DocumentPicker.tsx";

type Result = { run: AgentRun; proposals: Proposal[]; dropped: number; sources: SetupSource[] };

/**
 * Update a project from newer documents. The setup agent reads them against the
 * current record and stages every change as a proposal; this dialog shows what
 * was staged and sends the reviewer to the inbox. Nothing is applied here.
 */
export function UpdateWizard({ project, state, onStaged, onOpenInbox, onClose }: { project: Project; state: AppState; onStaged: (proposals: Proposal[]) => void; onOpenInbox: () => void; onClose: () => void }) {
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [snippets, setSnippets] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const usable = files.filter((f) => f.size <= 25_000_000).length + snippets.filter((s) => s.trim()).length;
  const canRun = !busy && (usable > 0 || note.trim() !== "");

  const run = async () => {
    if (!canRun) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("note", note);
      for (const s of snippets) if (s.trim()) form.append("snippet", s);
      for (const f of files) form.append("file", f, f.name);
      const r = await api.projectUpdate(project.id, form);
      setResult(r);
      onStaged(r.proposals);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    const failed = result.sources.filter((s) => s.error);
    const n = result.proposals.length;
    return (
      <Modal
        title={`Update ${project.name} from documents`}
        onClose={onClose}
        width={680}
        footer={
          <>
            <Btn onClick={onClose}>Close</Btn>
            {n > 0 && (
              <Btn tone="primary" onClick={onOpenInbox}>
                Review {n} in the inbox
              </Btn>
            )}
          </>
        }
      >
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "8px 0 10px", fontSize: 12, color: C.dim }}>
          <span>{result.run.model ?? "The setup agent"} read</span>
          {result.sources.filter((s) => !s.error).map((s) => (
            <Chip key={s.name}>{s.name} · {s.kind}</Chip>
          ))}
          {failed.map((s) => (
            <Tip key={s.name} label={s.error ?? "unusable"}>
              <Chip tone="bad">{s.name} · skipped</Chip>
            </Tip>
          ))}
        </div>
        <div role="status" className="vf-pop" style={{ background: n ? C.accentSoft : C.inset, border: `1px solid ${n ? C.accentLine : C.line}`, borderRadius: 8, padding: "12px 14px", fontSize: 13, color: C.text, lineHeight: 1.5 }}>
          {n === 0 ? "Nothing in the documents changes the record." : `${n} change${n === 1 ? "" : "s"} staged for your approval. Nothing has been applied.`}
          {result.dropped > 0 && <div style={{ fontSize: 12, color: C.mut, marginTop: 4 }}>{result.dropped} suggestion{result.dropped === 1 ? "" : "s"} dropped: no change, a repeat, or something the project does not have.</div>}
        </div>
        {n > 0 && (
          <ol style={{ margin: "12px 0 0", paddingLeft: 20, fontSize: 12.5, color: C.text2, lineHeight: 1.6 }}>
            {result.proposals.map((p) => (
              <li key={p.id} className="vf-pop" style={{ overflowWrap: "anywhere" }}>
                {describeAction(p.action, state, p.proj)}
                {p.rationale && <span style={{ color: C.dim }}> — {p.rationale}</span>}
              </li>
            ))}
          </ol>
        )}
        {result.run.output.includes("### Notes") && (
          <details style={{ marginTop: 12, fontSize: 12, color: C.mut }}>
            <summary style={{ cursor: "pointer" }}>Agent notes</summary>
            <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", margin: "6px 0 0", overflowWrap: "anywhere" }}>{result.run.output.slice(result.run.output.indexOf("### Notes") + 9).trim()}</pre>
          </details>
        )}
      </Modal>
    );
  }

  return (
    <Modal
      title={`Update ${project.name} from documents`}
      onClose={onClose}
      onSubmit={canRun ? run : undefined}
      width={680}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn tone="primary" disabled={!canRun} onClick={() => void run()}>
            {busy ? "Reading…" : "Stage changes for approval"}
          </Btn>
        </>
      }
    >
      <div style={{ fontSize: 12, color: C.mut, lineHeight: 1.55, marginTop: 8 }}>
        Hand the setup agent a revised charter, a new deck, a decision email. It compares them with the current record and stages each difference — milestones, releases, governance,
        people, targets — as a proposal in the inbox. Nothing changes until you apply it there.
      </div>
      <Lbl>Note for the agent (optional)</Lbl>
      <textarea
        style={{ ...inpStyle, height: "auto", minHeight: 56, padding: "8px 10px", resize: "vertical", lineHeight: 1.5, maxWidth: "100%" }}
        value={note}
        maxLength={4000}
        placeholder="e.g. The steering group moved the pilot to December; only the roadmap should change."
        onChange={(e) => setNote(e.target.value)}
      />
      <Lbl>Documents</Lbl>
      <DocumentPicker files={files} snippets={snippets} onFiles={setFiles} onSnippets={setSnippets} />
      {busy && (
        <div style={{ fontSize: 12.5, color: C.indigoHi, marginTop: 12 }} className="vf-pulse" role="status">
          Reading {usable} source{usable === 1 ? "" : "s"} against the current record…
        </div>
      )}
      {error && (
        <div role="alert" style={{ fontSize: 12.5, color: C.redHi, marginTop: 12 }}>
          {error}
        </div>
      )}
    </Modal>
  );
}
