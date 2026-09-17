// ================= keyboard shortcuts =================
//
// One place that lists every key the application answers to, opened with `?`
// from anywhere outside a text field. The list is built from the same chord
// table the router uses, so it cannot drift from what the keys do.

import { CHORDS } from "../router.ts";
import { Kbd, Modal } from "./primitives.tsx";
import { C } from "../theme.ts";

interface Row {
  keys: string[][];
  label: string;
}

const GROUPS: { title: string; rows: Row[] }[] = [
  {
    title: "Anywhere",
    rows: [
      { keys: [["⌘", "K"]], label: "Jump to a page or project" },
      { keys: [["⌘", "J"]], label: "Ask the workspace" },
      { keys: [["?"]], label: "This list" },
      { keys: [["esc"]], label: "Close a dialog, panel, or the palette" },
      { keys: [["tab"]], label: "Move between controls; the first stop skips to the page content" },
    ],
  },
  {
    title: "Go to",
    rows: CHORDS.map((c) => ({ keys: [["g", c.key]], label: c.label })),
  },
  {
    title: "Inbox",
    rows: [
      { keys: [["j"], ["↓"]], label: "Next proposal" },
      { keys: [["k"], ["↑"]], label: "Previous proposal" },
      { keys: [["a"]], label: "Apply the selected proposal" },
      { keys: [["d"]], label: "Dismiss the selected proposal" },
    ],
  },
  {
    title: "Dialogs and tabs",
    rows: [
      { keys: [["⌘", "↵"]], label: "Save or confirm the open dialog" },
      { keys: [["←"], ["→"]], label: "Move between a page's tabs when one has focus" },
    ],
  },
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose} width={520}>
      <div style={{ display: "grid", gap: 14, marginTop: 10 }}>
        {GROUPS.map((g) => (
          <section key={g.title} aria-labelledby={`vf-keys-${g.title.replace(/\W+/g, "-").toLowerCase()}`}>
            <h3 id={`vf-keys-${g.title.replace(/\W+/g, "-").toLowerCase()}`} style={{ margin: "0 0 4px", fontSize: 11, color: C.dim, letterSpacing: "0.05em", textTransform: "uppercase", fontWeight: 500 }}>{g.title}</h3>
            <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "minmax(96px, auto) 1fr", gap: "6px 14px", alignItems: "center", fontSize: 13 }}>
              {g.rows.map((r) => (
                <div key={r.label} style={{ display: "contents" }}>
                  <dt style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    {r.keys.map((combo, i) => (
                      <span key={i} style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
                        {i > 0 && <span style={{ color: C.dim, fontSize: 11, marginRight: 3 }}>or</span>}
                        {combo.map((k) => <Kbd key={k}>{k}</Kbd>)}
                      </span>
                    ))}
                  </dt>
                  <dd style={{ margin: 0, color: C.text2 }}>{r.label}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <div style={{ fontSize: 12, color: C.dim, marginTop: 14, lineHeight: 1.5 }}>Single-key shortcuts pause while a text field has focus. On Windows and Linux, ⌘ is Ctrl.</div>
    </Modal>
  );
}
