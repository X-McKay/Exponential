import { useEffect, useRef } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { TIER_LABEL } from "@valueflow/domain";
import type { MilestoneStatus, RiskTier } from "@valueflow/domain";
import { C, STATUS_COLOR, TIER_COLOR } from "../theme.ts";
import type { ChipTone } from "../theme.ts";

export function Ring({ pct, size = 22, stroke = 2.5, color = C.indigo }: { pct: number; size?: number; stroke?: number; color?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const safe = Number.isFinite(pct) ? Math.max(0, Math.min(pct, 1)) : 0;
  return (
    <svg width={size} height={size} style={{ flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.line2} strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeDasharray={`${c * safe} ${c}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dasharray .4s ease" }}
      />
    </svg>
  );
}

// Chips carry colour in the text (and optional dot); fills and borders stay faint.
const CHIP: Record<ChipTone, { bg: string; fg: string; bd: string; dot: string }> = {
  default: { bg: C.chipBg, fg: C.mut, bd: C.line2, dot: C.dim },
  accent: { bg: C.accentSoft, fg: C.indigoSoft, bd: C.accentLine, dot: C.indigoHi },
  good: { bg: C.goodSoft, fg: C.greenHi, bd: C.goodLine, dot: C.green },
  warn: { bg: C.warnSoft, fg: C.amber, bd: C.warnLine, dot: C.amber },
  bad: { bg: C.badSoft, fg: C.redHi, bd: C.badLine, dot: C.red },
};

export function Chip({ children, tone = "default", dot }: { children: ReactNode; tone?: ChipTone; dot?: boolean | string }) {
  const t = CHIP[tone];
  return (
    <span
      style={{
        fontSize: 11,
        lineHeight: "18px",
        padding: "0 7px",
        borderRadius: 4,
        background: t.bg,
        color: t.fg,
        border: `1px solid ${t.bd}`,
        whiteSpace: "nowrap",
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
      }}
    >
      {dot && <span style={{ width: 6, height: 6, borderRadius: "50%", background: typeof dot === "string" ? dot : t.dot, flexShrink: 0 }} />}
      {children}
    </span>
  );
}

/** Risk tier as a neutral chip with a coloured dot: readable without shouting. */
export function TierBadge({ tier }: { tier: RiskTier | null }) {
  if (!tier) return <Chip dot>Untiered</Chip>;
  return <Chip dot={TIER_COLOR[tier]}>{TIER_LABEL[tier]}</Chip>;
}

export function Avatar({ ini, size = 24 }: { ini: string; size?: number }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: C.line3,
        fontSize: size * 0.42,
        fontWeight: 500,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        color: C.text2,
        flexShrink: 0,
        border: `1px solid ${C.line2}`,
      }}
    >
      {ini}
    </span>
  );
}

export function Kpi({ label, value, sub, color = C.text, ring }: { label: string; value: ReactNode; sub: ReactNode; color?: string; ring?: number }) {
  return (
    <div className="vf-kpi" style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, padding: "14px 16px" }}>
      <div style={{ fontSize: 12, color: C.mut, marginBottom: 8 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {ring !== undefined && <Ring pct={ring} size={30} stroke={3} color={color} />}
        <span style={{ fontSize: 24, fontWeight: 550, color, letterSpacing: "-0.02em", lineHeight: 1.1 }}>{value}</span>
      </div>
      <div style={{ fontSize: 12, color: C.dim, marginTop: 6 }}>{sub}</div>
    </div>
  );
}

export function SectionCard({ title, right, children, pad = "14px" }: { title?: string; right?: ReactNode; children: ReactNode; pad?: string }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, marginBottom: 14 }}>
      {(title || right) && (
        <div className="vf-section-head" style={{ padding: "12px 14px", borderBottom: `1px solid ${C.line}` }}>
          <span style={{ fontSize: 13, fontWeight: 550, letterSpacing: "-0.01em" }}>{title}</span>
          {right}
        </div>
      )}
      <div style={{ padding: pad }}>{children}</div>
    </div>
  );
}

export function StatusIcon({ status, size = 11 }: { status: MilestoneStatus; size?: number }) {
  const c = STATUS_COLOR[status];
  const r = size / 2 - 1.2;
  const cx = size / 2;
  const cy = size / 2;
  const shape = (): ReactNode => {
    switch (status) {
      case "backlog":
        return <circle cx={cx} cy={cy} r={r} fill="none" stroke={c} strokeWidth="1.4" strokeDasharray="1.8 1.6" />;
      case "progress":
        return (
          <>
            <circle cx={cx} cy={cy} r={r} fill="none" stroke={c} strokeWidth="1.4" opacity="0.45" />
            <path d={`M ${cx} ${cy} L ${cx} ${cy - r} A ${r} ${r} 0 0 1 ${cx + r} ${cy} Z`} fill={c} />
          </>
        );
      case "eval":
        return (
          <>
            <circle cx={cx} cy={cy} r={r} fill="none" stroke={c} strokeWidth="1.4" opacity="0.45" />
            <path d={`M ${cx} ${cy} L ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - r} ${cy} Z`} fill={c} />
          </>
        );
      case "shipped":
        return (
          <>
            <circle cx={cx} cy={cy} r={r + 0.6} fill={c} />
            <path
              d={`M ${cx - r * 0.55} ${cy} l ${r * 0.4} ${r * 0.45} l ${r * 0.75} -${r * 0.95}`}
              fill="none"
              stroke={C.bg}
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        );
    }
  };
  return (
    <svg width={size} height={size} style={{ flexShrink: 0, display: "inline-block" }}>
      {shape()}
    </svg>
  );
}

// ---- keyboard hints and tooltips -----------------------------------------

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="vf-kbd">{children}</kbd>;
}

/**
 * Hover tooltip with an optional shortcut. Pure CSS (see .vf-tipwrap), so it
 * also shows on keyboard focus. `side` places it above (default) or to the right.
 */
export function Tip({ label, keys, side, children, style }: { label: string; keys?: string[]; side?: "top" | "right"; children: ReactNode; style?: CSSProperties }) {
  return (
    <span className="vf-tipwrap" data-side={side ?? "top"} style={style}>
      {children}
      <span className="vf-tip" role="tooltip">
        {label}
        {keys && keys.length > 0 && (
          <span style={{ display: "inline-flex", gap: 3 }}>
            {keys.map((k, i) => (
              <Kbd key={i}>{k}</Kbd>
            ))}
          </span>
        )}
      </span>
    </span>
  );
}

/** Loading placeholder block. */
export function Skeleton({ w = "100%", h = 14, style }: { w?: number | string; h?: number; style?: CSSProperties }) {
  return <span className="vf-skeleton" aria-hidden style={{ display: "block", width: w, height: h, ...style }} />;
}

// ---- forms --------------------------------------------------------------

export const inpStyle: CSSProperties = {
  boxSizing: "border-box",
  width: "100%",
  height: 32,
  background: C.inset,
  border: `1px solid ${C.line2}`,
  borderRadius: 6,
  color: C.text,
  fontSize: 13,
  padding: "0 10px",
  outline: "none",
  fontFamily: "inherit",
  transition: "border-color .12s",
};

export function Lbl({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return <label htmlFor={htmlFor} style={{ display: "block", fontSize: 12, color: C.mut, margin: "12px 0 5px" }}>{children}</label>;
}

const BTN = {
  default: { bg: C.field, fg: C.text, bd: C.line2 },
  primary: { bg: C.indigo, fg: "#fff", bd: C.indigo },
  danger: { bg: C.badSoft2, fg: C.redHi, bd: C.badLine2 },
} as const;

export function Btn({ children, onClick, tone = "default", disabled }: { children: ReactNode; onClick?: () => void; tone?: keyof typeof BTN; disabled?: boolean }) {
  const s = BTN[tone];
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      aria-disabled={disabled}
      disabled={disabled}
      style={{
        all: "unset",
        boxSizing: "border-box",
        cursor: disabled ? "default" : "pointer",
        fontSize: 13,
        fontWeight: 500,
        height: 32,
        padding: "0 14px",
        borderRadius: 6,
        background: s.bg,
        color: s.fg,
        border: `1px solid ${s.bd}`,
        opacity: disabled ? 0.45 : 1,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        transition: "opacity .12s",
      }}
    >
      {children}
    </button>
  );
}

/** Unstyled clickable element used throughout (the mockup's `all: unset` buttons). */
export const reset: CSSProperties = { all: "unset", boxSizing: "border-box", cursor: "pointer" };

/** Small outlined text button (Edit targets, Edit item…). */
export const ghostBtn: CSSProperties = {
  ...reset,
  fontSize: 12,
  color: C.mut,
  padding: "0 9px",
  height: 26,
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  border: `1px solid ${C.line2}`,
  borderRadius: 6,
  transition: "color .12s, border-color .12s",
};

export function Modal({
  title,
  onClose,
  onSubmit,
  children,
  footer,
  width = 580,
}: {
  title: string;
  onClose: () => void;
  /** Invoked on ⌘↵ / Ctrl+↵ anywhere in the dialog; the footer shows the hint. */
  onSubmit?: (() => void) | undefined;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const first = dialogRef.current?.querySelector<HTMLElement>("input, select, textarea, button, [tabindex]:not([tabindex='-1'])");
    first?.focus();
    const onWindowKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
      }
    };
    window.addEventListener("keydown", onWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
      document.body.style.overflow = prev;
      restoreRef.current?.focus();
    };
  }, []);
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (onSubmit && (e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      onSubmit();
    }
  };
  return (
    <div
      onClick={onClose}
      className="vf-overlay"
      style={{ position: "fixed", inset: 0, background: C.overlay, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          onKeyDown(e);
          if (e.key === "Tab") {
            const nodes = [...e.currentTarget.querySelectorAll<HTMLElement>("input, select, textarea, button, [tabindex]:not([tabindex='-1'])")].filter((x) => !x.hasAttribute("disabled"));
            if (nodes.length) {
              const first = nodes[0];
              const last = nodes[nodes.length - 1];
              if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
              else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
            }
          }
        }}
        ref={dialogRef}
        className="vf-modal"
        role="dialog"
        aria-modal
          aria-labelledby="vf-dialog-title"
        style={{
          width: "100%",
          maxWidth: width,
          maxHeight: "86vh",
          overflowY: "auto",
          background: C.raised,
          border: `1px solid ${C.line2}`,
          borderRadius: 12,
          boxShadow: `0 24px 64px ${C.shadow2}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 20px 0", position: "sticky", top: 0, background: C.raised, zIndex: 2 }}>
          <span id="vf-dialog-title" style={{ fontSize: 15, fontWeight: 550, letterSpacing: "-0.01em" }}>{title}</span>
          <Tip label="Close" keys={["esc"]}>
            <button type="button" onClick={onClose} aria-label="Close" className="vf-ghost" style={{ ...ghostBtn, width: 26, padding: 0, justifyContent: "center", border: "1px solid transparent" }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <path d="M2 2l8 8M10 2l-8 8" />
              </svg>
            </button>
          </Tip>
        </div>
        <div style={{ padding: "4px 20px 20px" }}>{children}</div>
        {footer && (
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              justifyContent: "flex-end",
              padding: "12px 20px",
              borderTop: `1px solid ${C.line}`,
              position: "sticky",
              bottom: 0,
              background: C.raised,
            }}
          >
            {footer}
            {onSubmit && (
              <span style={{ display: "inline-flex", gap: 3, marginLeft: 2 }} aria-hidden>
                <Kbd>⌘</Kbd>
                <Kbd>↵</Kbd>
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function Caret({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke={C.dim}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .15s", flexShrink: 0 }}
    >
      <path d="M3.5 2l3 3-3 3" />
    </svg>
  );
}

/**
 * The one list row: an optional leading glyph, a title line, a dim sub line,
 * and controls on the right. Proposals, rules, and runs all use it so the
 * pages read as one product.
 */
export function ListRow({
  lead,
  title,
  sub,
  right,
  below,
  onClick,
  selected,
  first,
  muted,
}: {
  lead?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
  /** Extra content under the title/sub column (folded details, previews). */
  below?: ReactNode;
  onClick?: () => void;
  selected?: boolean;
  first?: boolean;
  muted?: boolean;
}) {
  const body = (
    <>
      {lead !== undefined && <span style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", minWidth: 14, paddingTop: 2 }}>{lead}</span>}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13, color: C.text, lineHeight: 1.5, display: "block" }}>{title}</span>
        {sub !== undefined && <span style={{ fontSize: 11.5, color: C.dim, display: "block", marginTop: 2, lineHeight: 1.5 }}>{sub}</span>}
        {below}
      </span>
    </>
  );
  const style: CSSProperties = {
    display: "flex",
    gap: 12,
    alignItems: "flex-start",
    padding: "10px 12px",
    margin: "0 -12px",
    borderTop: first ? "none" : `1px solid ${C.line}`,
    background: selected ? C.accentSoft : "transparent",
    boxShadow: selected ? `inset 2px 0 0 ${C.indigo}` : "none",
    opacity: muted ? 0.55 : 1,
    transition: "background .12s",
  };
  return (
    <div style={style} data-selected={selected ? "1" : undefined}>
      {onClick ? (
        <button type="button" onClick={onClick} className="vf-row" style={{ ...reset, flex: 1, minWidth: 0, display: "flex", gap: 12, alignItems: "flex-start", textAlign: "left", borderRadius: 6 }}>
          {body}
        </button>
      ) : (
        body
      )}
      {right !== undefined && <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>{right}</span>}
    </div>
  );
}

export interface Notice {
  id: number;
  text: string;
  tone: "info" | "good" | "bad";
}

/** Bottom-right toasts; click to dismiss. */
export function Toasts({ notices, onDismiss }: { notices: Notice[]; onDismiss: (id: number) => void }) {
  if (notices.length === 0) return null;
  return (
    <div className="vf-toasts">
      {notices.map((n) => (
        <div key={n.id} className="vf-toast" data-tone={n.tone} role={n.tone === "bad" ? "alert" : "status"} onClick={() => onDismiss(n.id)}>
          <span style={{ flexShrink: 0, color: n.tone === "good" ? C.green : n.tone === "bad" ? C.red : C.indigoHi }}>{n.tone === "good" ? "✓" : n.tone === "bad" ? "✗" : "◌"}</span>
          <span>{n.text}</span>
        </div>
      ))}
    </div>
  );
}

/** A slim progress strip for the background benchmark or scout job. */
export function JobBar({ kind, done, total }: { kind: "benchmark" | "scout"; done: number; total: number }) {
  const known = total > 0;
  return (
    <div className="vf-jobbar" data-indeterminate={known ? "0" : "1"} role="status" aria-live="polite">
      <span className="vf-pulse" style={{ color: C.indigoHi }}>
        {kind === "scout" ? "Scouting models" : "Running benchmark"}
      </span>
      <span className="vf-jobtrack">
        <span style={{ width: known ? `${Math.round((100 * done) / total)}%` : "30%" }} />
      </span>
      <span style={{ fontVariantNumeric: "tabular-nums" }}>{known ? `${done} of ${total} ${kind === "scout" ? "model runs" : "cases"}` : "starting…"}</span>
    </div>
  );
}
