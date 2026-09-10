import type { CSSProperties, ReactNode } from "react";
import { TIER_LABEL } from "@valueflow/domain";
import type { MilestoneStatus, RiskTier } from "@valueflow/domain";
import { C, STATUS_COLOR } from "../theme.ts";
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

const CHIP: Record<ChipTone, { bg: string; fg: string; bd: string }> = {
  default: { bg: "#1B1E27", fg: C.mut, bd: C.line2 },
  accent: { bg: "rgba(110,123,242,.12)", fg: "#A5AEF7", bd: "rgba(110,123,242,.35)" },
  good: { bg: "rgba(76,195,138,.12)", fg: "#6FD6A4", bd: "rgba(76,195,138,.35)" },
  warn: { bg: "rgba(227,179,65,.12)", fg: C.amber, bd: "rgba(227,179,65,.35)" },
  bad: { bg: "rgba(229,83,75,.12)", fg: "#F08A84", bd: "rgba(229,83,75,.35)" },
};

export function Chip({ children, tone = "default" }: { children: ReactNode; tone?: ChipTone }) {
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
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {children}
    </span>
  );
}

export function TierBadge({ tier }: { tier: RiskTier | null }) {
  if (!tier) return <Chip>Untiered</Chip>;
  return <Chip tone={tier === 1 ? "bad" : tier === 2 ? "warn" : "good"}>{TIER_LABEL[tier]}</Chip>;
}

export function Avatar({ ini, size = 24 }: { ini: string; size?: number }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: "#2A2E3A",
        fontSize: size * 0.42,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#C6CAD6",
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
    <div style={{ flex: "1 1 150px", minWidth: 150, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, padding: "14px 16px" }}>
      <div style={{ fontSize: 12, color: C.mut, marginBottom: 8 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {ring !== undefined && <Ring pct={ring} size={30} stroke={3} color={color} />}
        <span style={{ fontSize: 24, fontWeight: 650, color, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" }}>{value}</span>
      </div>
      <div style={{ fontSize: 11.5, color: C.dim, marginTop: 6 }}>{sub}</div>
    </div>
  );
}

export function SectionCard({ title, right, children, pad = "14px" }: { title?: string; right?: ReactNode; children: ReactNode; pad?: string }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, marginBottom: 14 }}>
      {(title || right) && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", borderBottom: `1px solid ${C.line}` }}>
          <span style={{ fontSize: 13, fontWeight: 550 }}>{title}</span>
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
              stroke="#08090A"
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

// ---- forms --------------------------------------------------------------

export const inpStyle: CSSProperties = {
  boxSizing: "border-box",
  width: "100%",
  background: "#0E1015",
  border: `1px solid ${C.line2}`,
  borderRadius: 6,
  color: C.text,
  fontSize: 12.5,
  padding: "7px 9px",
  outline: "none",
  fontFamily: "inherit",
};

export function Lbl({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 11.5, color: C.mut, margin: "10px 0 4px" }}>{children}</div>;
}

const BTN = {
  default: { bg: "#1B1E27", fg: C.text, bd: C.line2 },
  primary: { bg: C.indigo, fg: "#fff", bd: C.indigo },
  danger: { bg: "rgba(229,83,75,.15)", fg: "#F08A84", bd: "rgba(229,83,75,.4)" },
} as const;

export function Btn({ children, onClick, tone = "default", disabled }: { children: ReactNode; onClick?: () => void; tone?: keyof typeof BTN; disabled?: boolean }) {
  const s = BTN[tone];
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      style={{
        all: "unset",
        boxSizing: "border-box",
        cursor: disabled ? "default" : "pointer",
        fontSize: 12.5,
        padding: "7px 14px",
        borderRadius: 7,
        background: s.bg,
        color: s.fg,
        border: `1px solid ${s.bd}`,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {children}
    </button>
  );
}

/** Unstyled clickable element used throughout (the mockup's `all: unset` buttons). */
export const reset: CSSProperties = { all: "unset", boxSizing: "border-box", cursor: "pointer" };

export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  return (
    <div
      onClick={onClose}
      className="vf-overlay"
      style={{ position: "fixed", inset: 0, background: "rgba(5,6,9,0.68)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="vf-modal"
        role="dialog"
        aria-label={title}
        style={{
          width: "100%",
          maxWidth: 580,
          maxHeight: "86vh",
          overflowY: "auto",
          background: "#13151C",
          border: `1px solid ${C.line2}`,
          borderRadius: 12,
          boxShadow: "0 24px 64px rgba(0,0,0,.6)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "13px 16px",
            borderBottom: `1px solid ${C.line}`,
            position: "sticky",
            top: 0,
            background: "#13151C",
            zIndex: 2,
          }}
        >
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>{title}</span>
          <button type="button" onClick={onClose} aria-label="Close" style={{ ...reset, color: C.dim, fontSize: 15, padding: "0 4px" }}>
            ✕
          </button>
        </div>
        <div style={{ padding: 16 }}>{children}</div>
        {footer && (
          <div
            style={{
              display: "flex",
              gap: 8,
              justifyContent: "flex-end",
              padding: "12px 16px",
              borderTop: `1px solid ${C.line}`,
              position: "sticky",
              bottom: 0,
              background: "#13151C",
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function Caret({ open }: { open: boolean }) {
  return <span style={{ color: C.dim, fontSize: 11, transform: open ? "rotate(90deg)" : "none", transition: "transform .15s", display: "inline-block" }}>▸</span>;
}
