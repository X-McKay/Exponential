import type { ReactNode } from "react";
import { Chip, ghostBtn, inpStyle, reset } from "../ui/primitives.tsx";
import { C } from "../theme.ts";

export const ACCEPT = ".docx,.pptx,.txt,.md,.markdown,.csv,.tsv,.json,.yaml,.yml,text/*";
export const MAX_SOURCES = 20;

const sizeLabel = (bytes: number): string => (bytes > 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} kB`);

/**
 * Files and pasted snippets for the setup and update agents: the same picker
 * in both places, with the same limits the server enforces (20 sources, 25 MB
 * a file), said up front rather than after a rejected upload.
 */
export function DocumentPicker({ files, snippets, onFiles, onSnippets, hint }: { files: File[]; snippets: string[]; onFiles: (files: File[]) => void; onSnippets: (snippets: string[]) => void; hint?: ReactNode }) {
  const total = files.length + snippets.length;
  const full = total >= MAX_SOURCES;
  const oversized = files.filter((f) => f.size > 25_000_000);
  return (
    <>
      <label
        className="vf-drop"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 4,
          padding: "18px 12px",
          border: `1px dashed ${C.line2}`,
          borderRadius: 8,
          cursor: full ? "not-allowed" : "pointer",
          color: C.mut,
          fontSize: 12.5,
          opacity: full ? 0.6 : 1,
          textAlign: "center",
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.currentTarget.dataset.over = "1";
        }}
        onDragLeave={(e) => {
          delete e.currentTarget.dataset.over;
        }}
        onDrop={(e) => {
          e.preventDefault();
          delete e.currentTarget.dataset.over;
          if (full) return;
          const picked = Array.from(e.dataTransfer.files ?? []);
          onFiles([...files, ...picked.filter((p) => !files.some((x) => x.name === p.name && x.size === p.size))].slice(0, MAX_SOURCES - snippets.length));
        }}
      >
        <input
          type="file"
          multiple
          disabled={full}
          accept={ACCEPT}
          style={{ display: "none" }}
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []);
            onFiles([...files, ...picked.filter((p) => !files.some((x) => x.name === p.name && x.size === p.size))].slice(0, MAX_SOURCES - snippets.length));
            e.target.value = "";
          }}
        />
        <span>{full ? `At most ${MAX_SOURCES} sources` : "Click or drop Word, PowerPoint, or text files"}</span>
        <span style={{ fontSize: 11, color: C.dim }}>.docx · .pptx · .txt · .md · .csv · up to 25 MB each — export PDFs to text first</span>
        {hint}
      </label>
      {files.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          {files.map((f) => (
            <span key={`${f.name}-${f.size}`} className="vf-pop" style={{ display: "inline-flex", alignItems: "center", gap: 6, maxWidth: "100%", fontSize: 12, color: C.text, background: C.inset, border: `1px solid ${f.size > 25_000_000 ? C.badLine2 : C.line2}`, borderRadius: 6, padding: "3px 8px" }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{f.name}</span>
              <span style={{ color: f.size > 25_000_000 ? C.redHi : C.dim, flexShrink: 0 }}>{sizeLabel(f.size)}</span>
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => onFiles(files.filter((y) => y !== f))} style={{ ...reset, color: C.dim, fontSize: 12, flexShrink: 0 }}>
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      {oversized.length > 0 && (
        <div role="alert" style={{ fontSize: 12, color: C.redHi, marginTop: 6 }}>
          {oversized.length === 1 ? `${oversized[0]?.name} is larger than 25 MB and will be skipped.` : `${oversized.length} files are larger than 25 MB and will be skipped.`}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "14px 0 4px", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: C.mut }}>Text snippets</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          {total > 0 && <Chip>{total} of {MAX_SOURCES} sources</Chip>}
          <button type="button" disabled={full} onClick={() => onSnippets([...snippets, ""])} style={{ ...ghostBtn, border: "none", color: C.indigoHi, opacity: full ? 0.5 : 1 }}>
            + Add snippet
          </button>
        </span>
      </div>
      {snippets.map((s, i) => (
        <div key={i} className="vf-fields vf-pop" style={{ display: "grid", gridTemplateColumns: "1fr 26px", gap: 6, marginBottom: 6 }}>
          <textarea
            style={{ ...inpStyle, height: "auto", minHeight: 56, padding: "8px 10px", resize: "vertical", lineHeight: 1.5, maxWidth: "100%" }}
            value={s}
            maxLength={40_000}
            placeholder="Paste an email, a chat thread, meeting notes…"
            onChange={(e) => onSnippets(snippets.map((x, xi) => (xi === i ? e.target.value : x)))}
          />
          <button type="button" aria-label="Remove snippet" onClick={() => onSnippets(snippets.filter((_, xi) => xi !== i))} style={{ ...ghostBtn, width: 26, height: 32, padding: 0, justifyContent: "center", border: "1px solid transparent" }}>
            ✕
          </button>
        </div>
      ))}
    </>
  );
}
