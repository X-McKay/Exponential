import { useMemo, useState } from "react";
import { Btn, Modal, inpStyle } from "../ui/primitives.tsx";
import { C } from "../theme.ts";

/** The slice of a zod schema the editor needs, so this file does not import zod. */
export interface DocSchema<T> {
  safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } };
}

type Check<T> = { ok: true; data: T } | { ok: false; errors: string[] };

const check = <T,>(text: string, schema: DocSchema<T>): Check<T> => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`Not valid JSON: ${e instanceof Error ? e.message : String(e)}`] };
  }
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data };
  return { ok: false, errors: parsed.error.issues.slice(0, 8).map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`) };
};

/**
 * Edit a whole JSON document (an external-system mirror) with the same schema
 * the server enforces, so what you save is exactly what the API accepts.
 */
export function JsonDocEditor<T>({
  title,
  help,
  value,
  schema,
  onSave,
  onClose,
}: {
  title: string;
  help?: string;
  value: unknown;
  schema: DocSchema<T>;
  onSave: (doc: T) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const result = useMemo(() => check(text, schema), [text, schema]);
  const submit = () => {
    if (result.ok) onSave(result.data);
  };
  return (
    <Modal
      title={title}
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <span style={{ marginRight: "auto", fontSize: 12, color: result.ok ? C.green : C.dim }}>{result.ok ? "Valid" : `${result.errors.length} problem${result.errors.length === 1 ? "" : "s"}`}</span>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn tone="primary" disabled={!result.ok} onClick={submit}>
            Save
          </Btn>
        </>
      }
    >
      {help && <div style={{ fontSize: 12, color: C.mut, lineHeight: 1.55, margin: "8px 0 10px" }}>{help}</div>}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        aria-label={title}
        style={{
          ...inpStyle,
          height: "58vh",
          minHeight: 260,
          padding: "10px 12px",
          resize: "vertical",
          lineHeight: 1.5,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 12,
          whiteSpace: "pre",
          borderColor: result.ok ? C.line2 : C.badLine2,
        }}
      />
      {!result.ok && (
        <ul style={{ margin: "8px 0 0", padding: "0 0 0 18px", fontSize: 12, color: C.redHi, lineHeight: 1.6 }}>
          {result.errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
