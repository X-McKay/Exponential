import { useState } from "react";
import { earliestStart, isMeasurable, milestoneStart, monthIndex, monthLabel, releaseSpan, roadmapCalendar, STATUS_LABEL, tierOf } from "@valueflow/domain";
import type { Calendar, Milestone, Project, Release, ReleaseState, YearMonth } from "@valueflow/domain";
import { C, STATUS_COLOR, releaseToneColor } from "../theme.ts";

// A grouped Gantt. Every release is a wide bar from its earliest milestone's
// start to the month it ships, with the readiness tone fading in toward the
// tail. Its milestones sit beneath as thin bars in their status colour, each
// ending in a diamond coloured by the gate tier it has cleared. Names sit
// directly above their own bar so the timeline gets the full width. The axis
// covers only the months where work is planned. Clicking a release selects
// it; double-clicking (or Space) folds its milestones into the release bar as
// diamonds.

const W = 1080;
const X0 = 16;
const XR = 14;
const PT = 60;
const PB = 14;
/** Release bar height. */
const BAR = 26;
/** Milestone bar height. */
const MS_BAR = 10;
const REL_LABEL = 22;
const REL_GAP = 12;
/** Extra row beneath a folded release for its milestone captions. */
const REL_CAPTION = 16;
const MS_LABEL = 18;
const MS_GAP = 10;
const REL_H = REL_LABEL + BAR + REL_GAP;
const MS_H = MS_LABEL + MS_BAR + MS_GAP;
const MONTH = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"] as const;

const monthName = (ym: YearMonth): string => MONTH[Number(ym.slice(5, 7)) - 1] ?? ym;
const yearOf = (ym: YearMonth): string => ym.slice(0, 4);

function Diamond({ x, y, size = 6.5, color, hollow = false }: { x: number; y: number; size?: number; color: string; hollow?: boolean }) {
  return (
    <rect
      x={x - size}
      y={y - size}
      width={size * 2}
      height={size * 2}
      transform={`rotate(45 ${x} ${y})`}
      fill={hollow ? C.panel : color}
      stroke={hollow ? color : C.panel}
      strokeWidth="1.5"
      rx="1.5"
    />
  );
}

const gateDotColor = (m: Milestone): string => {
  const t = tierOf(m);
  switch (t) {
    case 2:
      return C.green;
    case 1:
      return C.indigo;
    case 0:
      return isMeasurable(m) ? C.amber : C.dim;
  }
};

/** Target marker: filled once the milestone is being measured, hollow before. */
function Target({ x, y, m, size }: { x: number; y: number; m: Milestone; size: number }) {
  return <Diamond x={x} y={y} size={size} color={gateDotColor(m)} hollow={!isMeasurable(m)} />;
}

interface Group {
  key: string;
  release: Release | null;
  state: ReleaseState | null;
  milestones: Milestone[];
  start: YearMonth;
  end: YearMonth;
}

export function RoadmapTimeline({
  p,
  releases,
  states,
  onPick,
  picked,
  cal,
}: {
  p: Project;
  releases: Release[];
  states: ReleaseState[];
  onPick: (id: string) => void;
  picked: string | null;
  cal: Calendar;
}) {
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());
  /** Axis trimmed to the planned months; `cal` is the app-wide one. */
  const axis = roadmapCalendar(p, releases, cal);
  const toggle = (key: string) =>
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const byMonth = (a: Milestone, b: Milestone) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0);
  const loose = p.milestones.filter((m) => !releases.some((r) => r.milestoneIds.includes(m.id))).sort(byMonth);
  const groups: Group[] = releases.map((r, i) => ({
    key: r.id,
    release: r,
    state: states[i] ?? null,
    milestones: p.milestones.filter((m) => r.milestoneIds.includes(m.id)).sort(byMonth),
    ...releaseSpan(r, p),
  }));
  const lastLoose = loose[loose.length - 1];
  if (lastLoose) groups.push({ key: "__loose", release: null, state: null, milestones: loose, start: earliestStart(loose, lastLoose.month), end: lastLoose.month });

  const isOpen = (g: Group) => !folded.has(g.key);
  const groupHeight = (g: Group) => REL_H + (isOpen(g) ? g.milestones.length * MS_H : g.release ? REL_CAPTION : 0);
  const H = PT + groups.reduce((a, g) => a + groupHeight(g), 0) + PB;

  const MONTHS = axis.months;
  const n = MONTHS.length;
  const cw = (W - X0 - XR) / Math.max(1, n);
  /** Left edge of month i. */
  const X = (i: number) => X0 + i * cw;
  /** Centre of month i. */
  const XC = (i: number) => X0 + (i + 0.5) * cw;
  const XM = (ym: YearMonth) => X(monthIndex(axis, ym));
  const XMC = (ym: YearMonth) => XC(monthIndex(axis, ym));
  const dayFrac = Math.min(1, Math.max(0, (new Date(axis.asOf).getUTCDate() - 1) / 30));
  /** Today is drawn only when it falls inside the planned months; before them everything is planned, after them nothing is. */
  const todayOnAxis = axis.today >= 0 && axis.today < n;
  const XT = todayOnAxis ? X(axis.today) + cw * dayFrac : axis.today < 0 ? X(0) : X(n);
  const captionChars = Math.max(14, Math.floor((cw * 2.4) / 5.6));
  const trunc = (s: string, k: number) => (s.length > k ? s.slice(0, k - 1) + "…" : s);

  /** First month index of each calendar year on the axis. */
  const yearBands = MONTHS.flatMap((mo, i) => (i === 0 || yearOf(mo) !== yearOf(MONTHS[i - 1]!) ? [{ year: yearOf(mo), from: i }] : []));

  const placed = groups.reduce<{ g: Group; top: number }[]>((acc, g) => {
    const prev = acc[acc.length - 1];
    acc.push({ g, top: prev ? prev.top + groupHeight(prev.g) : PT });
    return acc;
  }, []);
  const rows = placed.map(({ g, top }) => {
    const open = isOpen(g);
    const gh = groupHeight(g);
    const barY = top + REL_LABEL;
    const x1 = XM(g.start);
    const x2 = X(monthIndex(axis, g.end) + 1);
    const lx = x1 + 6;
    const caret = open ? `M ${lx} ${barY - 13} l 3.5 3.5 l 3.5 -3.5` : `M ${lx + 1.5} ${barY - 15} l 3.5 3.5 l -3.5 3.5`;
    const count = `${g.milestones.length} milestone${g.milestones.length === 1 ? "" : "s"}`;

    const milestoneRows = open
      ? g.milestones.map((m, i) => {
          const my = barY + BAR + REL_GAP + i * MS_H + MS_LABEL;
          const mx1 = XM(milestoneStart(m));
          const mx2 = X(monthIndex(axis, m.month) + 1);
          const color = STATUS_COLOR[m.status];
          const backlog = m.status === "backlog";
          return (
            <g key={m.id}>
              <title>{`${m.id} · ${m.name} · ${STATUS_LABEL[m.status]} · ${monthLabel(milestoneStart(m), axis.todayYm)} → ${monthLabel(m.month, axis.todayYm)}`}</title>
              <circle cx={mx1 + 7} cy={my - 8} r="3" fill={color} />
              <text x={mx1 + 15} y={my - 4.5} fontSize="11" fill={C.text2}>
                {m.name}
                <tspan dx="8" fontSize="10" fill={C.dim}>
                  {STATUS_LABEL[m.status]}
                </tspan>
              </text>
              <rect
                x={mx1}
                y={my}
                width={Math.max(4, mx2 - mx1)}
                height={MS_BAR}
                rx={MS_BAR / 2}
                fill={backlog ? C.field : color}
                opacity={backlog ? 1 : 0.22}
                stroke={backlog ? C.line2 : "none"}
                strokeDasharray={backlog ? "3 3" : undefined}
              />
              {!backlog && <rect x={mx1} y={my} width={Math.max(4, mx2 - mx1)} height={MS_BAR} rx={MS_BAR / 2} fill="none" stroke={color} strokeWidth="1" opacity="0.55" />}
              <Target x={XMC(m.month)} y={my + MS_BAR / 2} m={m} size={4.5} />
            </g>
          );
        })
      : null;

    if (!g.release) {
      return (
        <g key={g.key}>
          <g
            role="button"
            tabIndex={0}
            aria-expanded={open}
            aria-label={`Milestones not in a release, ${count}. Double-click or press Space to ${open ? "fold" : "expand"}.`}
            style={{ cursor: "pointer" }}
            onDoubleClick={() => toggle(g.key)}
            onKeyDown={(e) => {
              if (e.key === " ") {
                e.preventDefault();
                toggle(g.key);
              }
            }}
          >
            <rect x={X0} y={top} width={W - X0 - XR} height={gh} rx="6" fill={C.panel2} opacity="0.35" />
            <path d={caret} fill="none" stroke={C.dim} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            <text x={lx + 16} y={barY - 7} fontSize="12" fontWeight="600" fill={C.mut}>
              Not in a release
              <tspan dx="8" fontSize="10.5" fontWeight="400" fill={C.dim}>
                {count}
              </tspan>
            </text>
            {!open && <text x={lx + 16} y={barY + 12} fontSize="10.5" fill={C.dim}>{g.milestones.map((m) => m.name).join(" · ")}</text>}
          </g>
          {milestoneRows}
        </g>
      );
    }

    const r = g.release;
    const st = g.state;
    const tone = st ? releaseToneColor(st.tone) : C.dim;
    const selected = picked === r.id;
    const gradId = `rm-tail-${r.id}`;
    const caption = `ships ${monthLabel(r.month, axis.todayYm)}`;
    const captionFits = x2 + 8 + caption.length * 5.8 < W - XR;
    return (
      <g key={g.key}>
        <g
          role="button"
          tabIndex={0}
          aria-pressed={selected}
          aria-expanded={open}
          aria-label={`Release ${r.id} ${r.name}, ${st?.label ?? ""}, ${count}. Enter selects; double-click or Space ${open ? "folds" : "expands"} its milestones.`}
          style={{ cursor: "pointer" }}
          onClick={() => onPick(r.id)}
          onDoubleClick={(e) => {
            e.preventDefault();
            toggle(g.key);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onPick(r.id);
            } else if (e.key === " ") {
              e.preventDefault();
              toggle(g.key);
            }
          }}
        >
          <title>{`${r.id} · ${r.name} · ${monthLabel(g.start, axis.todayYm)} → ships ${monthLabel(r.month, axis.todayYm)} · ${st ? `${st.met}/${st.total} criteria met · ${st.label}` : ""}`}</title>
          <defs>
            <linearGradient id={gradId} x1="0" x2="1" y1="0" y2="0">
              <stop offset="45%" stopColor={tone} stopOpacity="0" />
              <stop offset="100%" stopColor={tone} stopOpacity="0.55" />
            </linearGradient>
          </defs>
          <rect x={X0} y={top} width={W - X0 - XR} height={gh} rx="6" fill={C.panel2} opacity={selected ? 0.9 : open ? 0.45 : 0.3} stroke={selected ? C.line2 : "none"} />
          <path d={caret} fill="none" stroke={C.dim} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          <Diamond x={lx + 18} y={barY - 11} size={4.5} color={tone} />
          <text x={lx + 28} y={barY - 7} fontSize="12" fontWeight="600" fill={C.text}>
            {r.id}
            {"  "}
            {r.name}
            {st && (
              <tspan dx="10" fontSize="10.5" fontWeight="400" fill={st.tone === "good" ? C.mut : tone}>
                {st.met}/{st.total} criteria · {st.label}
              </tspan>
            )}
          </text>
          <rect x={x1} y={barY} width={Math.max(4, x2 - x1)} height={BAR} rx="4" fill={C.field} stroke={C.line2} strokeWidth="1" />
          <rect x={x1} y={barY} width={Math.max(4, x2 - x1)} height={BAR} rx="4" fill={`url(#${gradId})`} />
          <line x1={x2} x2={x2} y1={barY - 3} y2={barY + BAR + 3} stroke={tone} strokeWidth="2" strokeLinecap="round" />
          <text x={captionFits ? x2 + 8 : x2 - 8} y={barY + BAR / 2 + 4} fontSize="10.5" fill={captionFits ? C.dim : C.text2} textAnchor={captionFits ? "start" : "end"}>
            {caption}
          </text>
          {!open &&
            g.milestones.map((m) => (
              <g key={m.id}>
                <title>{`${m.id} · ${m.name} · ${STATUS_LABEL[m.status]} · target ${monthLabel(m.month, axis.todayYm)}`}</title>
                <Target x={XMC(m.month)} y={barY + BAR / 2} m={m} size={5} />
                <text x={XMC(m.month)} y={barY + BAR + 13} fontSize="10" fill={C.dim} textAnchor="middle">
                  {trunc(m.name, captionChars)}
                </text>
              </g>
            ))}
        </g>
        {milestoneRows}
      </g>
    );
  });

  return (
    <div style={{ overflowX: "auto" }}>
      <svg aria-label="Project roadmap: releases and their milestones by month" viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", minWidth: 860, display: "block", userSelect: "none" }}>
        <defs>
          <pattern id="rmH" width="7" height="7" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <line x1="0" y1="0" x2="0" y2="7" stroke={C.line2} strokeWidth="1.3" />
          </pattern>
        </defs>
        <rect x={XT} y={PT - 4} width={Math.max(0, X(n) - XT)} height={H - PT - PB + 4} fill="url(#rmH)" opacity="0.45" />
        {yearBands.map((b) => (
          <g key={b.year}>
            <text x={X(b.from) + 6} y={14} fontSize="10" fill={C.dim} fontWeight="600" letterSpacing="0.06em">
              {b.year}
            </text>
            {b.from > 0 && <line x1={X(b.from)} x2={X(b.from)} y1={4} y2={H - PB} stroke={C.line3} strokeWidth="1" />}
          </g>
        ))}
        {MONTHS.map((mo, i) => {
          const isToday = i === axis.today;
          const quarter = Number(mo.slice(5, 7)) % 3 === 1;
          return (
            <g key={mo}>
              <line x1={X(i)} x2={X(i)} y1={PT - 4} y2={H - PB} stroke={quarter ? C.line2 : C.line} strokeWidth="0.8" />
              <text x={XC(i)} y={32} fontSize="9.5" fill={isToday ? C.text : C.dim} textAnchor="middle" fontWeight={isToday ? 600 : 400} letterSpacing="0.05em">
                {monthName(mo)}
              </text>
            </g>
          );
        })}
        <line x1={X(n)} x2={X(n)} y1={PT - 4} y2={H - PB} stroke={C.line} strokeWidth="0.8" />
        {todayOnAxis && (
          <>
            <line x1={XT} x2={XT} y1={PT - 8} y2={H - PB} stroke={C.indigoHi} strokeWidth="1.2" strokeDasharray="3 3" opacity="0.9" />
            <text x={XT + 5} y={PT - 1} fontSize="9" fill={C.indigoHi} fontWeight="600">
              Today
            </text>
          </>
        )}
        {rows}
      </svg>
    </div>
  );
}
