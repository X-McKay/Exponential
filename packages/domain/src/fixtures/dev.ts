// Sample development activity. Times are offsets from the state's `asOf` so
// the sample stays "recent" whenever it is materialised; commit history is
// generated deterministically per repo. The sample connector materialises
// this shape; a real connector (GitHub) produces the same facts from the API.

import { sortDevFacts } from "../dev.ts";
import type { Build, CommitDay, DevFacts, PullRequest, RepoStat, SyncRun } from "../types.ts";
import { PROJECTS } from "./projects.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

interface SampleRepo extends Omit<RepoStat, "measuredAt"> {
  /** Relative commit volume, 1–10. */
  level: number;
}
interface SamplePr extends Omit<PullRequest, "openedAt" | "mergedAt" | "updatedAt" | "url"> {
  /** Hours before asOf the PR was opened (open PRs) or merged (merged PRs). */
  hoursAgo: number;
  /** Hours the PR took to merge; merged PRs only. */
  reviewHours?: number;
}
interface SampleBuild extends Omit<Build, "startedAt" | "url"> {
  hoursAgo: number;
}
interface SampleDev {
  repos: SampleRepo[];
  prs: SamplePr[];
  builds: SampleBuild[];
}

export const DEV_SAMPLE: Record<string, SampleDev> = {
  invoice: {
    repos: [
      { repo: "invoice-extraction-svc", branch: "main", coverage: 88, quality: "A", lang: "Python", level: 9 },
      { repo: "invoice-po-matcher", branch: "main", coverage: 79, quality: "B+", lang: "Python", level: 8 },
      { repo: "invoice-evals", branch: "main", coverage: 91, quality: "A", lang: "Python", level: 4 },
    ],
    prs: [
      { repo: "invoice-po-matcher", number: 412, title: "Add drift alert thresholds to matching metrics", author: "TO", status: "open", checks: "running", add: 214, del: 38, hoursAgo: 3, reviewers: ["PN"] },
      { repo: "invoice-po-matcher", number: 409, title: "Batch OCR fallback for scanned supplier invoices", author: "SL", status: "open", checks: "fail", add: 486, del: 92, hoursAgo: 26, reviewers: ["JA", "PN"] },
      { repo: "invoice-extraction-svc", number: 408, title: "Line-item confidence calibration", author: "SL", status: "merged", checks: "pass", add: 167, del: 41, hoursAgo: 48, reviewHours: 5, reviewers: ["JA"] },
      { repo: "invoice-evals", number: 71, title: "Golden set v5: add 2 new supplier formats", author: "JA", status: "merged", checks: "pass", add: 1240, del: 12, hoursAgo: 72, reviewHours: 3, reviewers: ["SL"] },
      { repo: "invoice-extraction-svc", number: 405, title: "Refactor: extract layout inference into a module", author: "PN", status: "merged", checks: "pass", add: 623, del: 587, hoursAgo: 96, reviewHours: 9, reviewers: ["SL", "TO"] },
      { repo: "invoice-extraction-svc", number: 401, title: "Retry policy for ERP API timeouts", author: "TO", status: "merged", checks: "pass", add: 88, del: 20, hoursAgo: 190, reviewHours: 4, reviewers: ["PN"] },
      { repo: "invoice-po-matcher", number: 398, title: "Streaming parser for multi-page invoices", author: "SL", status: "merged", checks: "pass", add: 702, del: 133, hoursAgo: 300, reviewHours: 14, reviewers: ["JA", "PN"] },
      { repo: "invoice-evals", number: 68, title: "Per-supplier breakdown in the eval report", author: "JA", status: "merged", checks: "pass", add: 210, del: 31, hoursAgo: 420, reviewHours: 2, reviewers: ["SL"] },
    ],
    builds: [
      { repo: "invoice-po-matcher", id: "#1148", branch: "pr/409", kind: "ci", status: "fail", note: "test_ocr_fallback: 3 failures", hoursAgo: 2, durationS: 372 },
      { repo: "invoice-extraction-svc", id: "#1147", branch: "main", kind: "deploy", status: "pass", note: "deploy → staging", hoursAgo: 5, durationS: 280 },
      { repo: "invoice-evals", id: "#1146", branch: "main", kind: "eval", status: "pass", note: "nightly eval run · gates green", hoursAgo: 9, durationS: 1323 },
      { repo: "invoice-po-matcher", id: "#1145", branch: "main", kind: "deploy", status: "pass", note: "deploy → prod (canary)", hoursAgo: 26, durationS: 471 },
      { repo: "invoice-extraction-svc", id: "#1144", branch: "main", kind: "ci", status: "pass", note: "unit + contract tests", hoursAgo: 30, durationS: 251 },
      { repo: "invoice-po-matcher", id: "#1143", branch: "pr/412", kind: "ci", status: "pass", note: "unit tests", hoursAgo: 40, durationS: 301 },
      { repo: "invoice-extraction-svc", id: "#1142", branch: "main", kind: "deploy", status: "pass", note: "deploy → prod", hoursAgo: 75, durationS: 455 },
      { repo: "invoice-evals", id: "#1141", branch: "main", kind: "eval", status: "pass", note: "nightly eval run · gates green", hoursAgo: 81, durationS: 1290 },
    ],
  },
  clauses: {
    repos: [
      { repo: "clause-extractor", branch: "main", coverage: 74, quality: "B+", lang: "Python", level: 6 },
      { repo: "contract-schema", branch: "main", coverage: 82, quality: "A−", lang: "Rust", level: 3 },
    ],
    prs: [
      { repo: "clause-extractor", number: 188, title: "Recall improvements: nested obligation clauses", author: "SL", status: "open", checks: "pass", add: 342, del: 118, hoursAgo: 6, reviewers: ["JA", "LF"] },
      { repo: "contract-schema", number: 186, title: "Schema v0.9: liability caps and indemnities", author: "JA", status: "open", checks: "pass", add: 156, del: 22, hoursAgo: 50, reviewers: ["LF"] },
      { repo: "clause-extractor", number: 184, title: "Add SME disagreement flags to eval output", author: "SL", status: "merged", checks: "pass", add: 98, del: 14, hoursAgo: 74, reviewHours: 11, reviewers: ["LF"] },
      { repo: "clause-extractor", number: 181, title: "Dual-approval state machine for clause activation", author: "JA", status: "merged", checks: "pass", add: 411, del: 63, hoursAgo: 150, reviewHours: 20, reviewers: ["LF", "DM"] },
      { repo: "contract-schema", number: 179, title: "Validate clause scopes against the contract taxonomy", author: "JA", status: "merged", checks: "pass", add: 133, del: 40, hoursAgo: 330, reviewHours: 8, reviewers: ["LF"] },
    ],
    builds: [
      { repo: "clause-extractor", id: "#402", branch: "main", kind: "eval", status: "pass", note: "eval run · recall 86% (below gate)", hoursAgo: 4, durationS: 1904 },
      { repo: "contract-schema", id: "#401", branch: "main", kind: "ci", status: "pass", note: "schema validation suite", hoursAgo: 25, durationS: 138 },
      { repo: "clause-extractor", id: "#400", branch: "pr/185", kind: "ci", status: "fail", note: "clause splitter regression", hoursAgo: 49, durationS: 1689 },
      { repo: "clause-extractor", id: "#399", branch: "main", kind: "ci", status: "pass", note: "unit + golden set", hoursAgo: 70, durationS: 1520 },
      { repo: "clause-extractor", id: "#398", branch: "main", kind: "deploy", status: "pass", note: "deploy → shadow", hoursAgo: 160, durationS: 610 },
    ],
  },
  search: {
    repos: [{ repo: "knowledge-search-agents", branch: "main", coverage: 58, quality: "B", lang: "Python", level: 4 }],
    prs: [
      { repo: "knowledge-search-agents", number: 54, title: "Citation verifier with source pinning", author: "SL", status: "open", checks: "running", add: 388, del: 45, hoursAgo: 25, reviewers: ["JA"] },
      { repo: "knowledge-search-agents", number: 52, title: "Rubric scoring harness for reviewer evals", author: "GK", status: "open", checks: "pass", add: 205, del: 0, hoursAgo: 49, reviewers: ["SL"] },
      { repo: "knowledge-search-agents", number: 49, title: "Answer planner: handbook section templates", author: "SL", status: "merged", checks: "pass", add: 512, del: 88, hoursAgo: 120, reviewHours: 26, reviewers: ["JA", "GK"] },
      { repo: "knowledge-search-agents", number: 45, title: "Ticket fixtures for offline evals", author: "GK", status: "merged", checks: "pass", add: 260, del: 9, hoursAgo: 260, reviewHours: 30, reviewers: ["SL"] },
    ],
    builds: [
      { repo: "knowledge-search-agents", id: "#96", branch: "main", kind: "ci", status: "fail", note: "flaky: ticket fixture timeout", hoursAgo: 7, durationS: 750 },
      { repo: "knowledge-search-agents", id: "#95", branch: "main", kind: "ci", status: "pass", note: "unit + rubric smoke tests", hoursAgo: 27, durationS: 542 },
      { repo: "knowledge-search-agents", id: "#94", branch: "pr/52", kind: "ci", status: "pass", note: "unit tests", hoursAgo: 50, durationS: 501 },
      { repo: "knowledge-search-agents", id: "#93", branch: "main", kind: "ci", status: "fail", note: "rubric harness import error", hoursAgo: 120, durationS: 88 },
    ],
  },
  triage: {
    repos: [
      { repo: "triage-assistant", branch: "main", coverage: 84, quality: "A−", lang: "TypeScript", level: 7 },
      { repo: "triage-evals", branch: "main", coverage: 90, quality: "A", lang: "Python", level: 3 },
    ],
    prs: [
      { repo: "triage-assistant", number: 233, title: "Routing suggestions behind a per-queue flag", author: "SL", status: "open", checks: "pass", add: 298, del: 41, hoursAgo: 12, reviewers: ["MC", "RP"] },
      { repo: "triage-evals", number: 58, title: "Weekly eval report: acceptance rate by category", author: "RP", status: "merged", checks: "pass", add: 144, del: 18, hoursAgo: 31, reviewHours: 4, reviewers: ["SL"] },
      { repo: "triage-assistant", number: 229, title: "Redact customer identifiers before prompting", author: "RP", status: "merged", checks: "pass", add: 212, del: 66, hoursAgo: 110, reviewHours: 7, reviewers: ["SL", "TO"] },
      { repo: "triage-assistant", number: 224, title: "Draft response templates per category", author: "SL", status: "merged", checks: "pass", add: 388, del: 120, hoursAgo: 240, reviewHours: 16, reviewers: ["MC"] },
    ],
    builds: [
      { repo: "triage-evals", id: "#211", branch: "main", kind: "eval", status: "pass", note: "weekly eval · grounded 96%, acceptance 71%", hoursAgo: 31, durationS: 640 },
      { repo: "triage-assistant", id: "#210", branch: "pr/233", kind: "ci", status: "pass", note: "unit + integration", hoursAgo: 12, durationS: 420 },
      { repo: "triage-assistant", id: "#209", branch: "main", kind: "deploy", status: "pass", note: "deploy → prod (queue 1)", hoursAgo: 100, durationS: 380 },
      { repo: "triage-assistant", id: "#208", branch: "main", kind: "ci", status: "pass", note: "unit + integration", hoursAgo: 111, durationS: 415 },
    ],
  },
  meetings: {
    repos: [{ repo: "meeting-notes", branch: "main", coverage: 86, quality: "A", lang: "TypeScript", level: 2 }],
    prs: [
      { repo: "meeting-notes", number: 141, title: "Monthly quality sample: export to the dashboard", author: "RP", status: "merged", checks: "pass", add: 96, del: 12, hoursAgo: 200, reviewHours: 6, reviewers: ["HS"] },
      { repo: "meeting-notes", number: 139, title: "Bump model version and refresh the system card", author: "RP", status: "merged", checks: "pass", add: 44, del: 30, hoursAgo: 560, reviewHours: 20, reviewers: ["HS"] },
    ],
    builds: [
      { repo: "meeting-notes", id: "#530", branch: "main", kind: "eval", status: "pass", note: "monthly quality sample · gates hold", hoursAgo: 200, durationS: 910 },
      { repo: "meeting-notes", id: "#529", branch: "main", kind: "deploy", status: "pass", note: "deploy → prod", hoursAgo: 201, durationS: 300 },
      { repo: "meeting-notes", id: "#528", branch: "main", kind: "ci", status: "pass", note: "unit tests", hoursAgo: 202, durationS: 240 },
    ],
  },
};

/** Deterministic pseudo-random in [0, 1). */
const rnd = (seed: number): number => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const hash = (s: string): number => {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 100000;
  return h;
};

const iso = (asOf: string, hoursAgo: number): string => new Date(new Date(asOf).getTime() - hoursAgo * HOUR).toISOString();

/** Commit days for one repo over the trailing `days`, split across the project's team by seniority. */
export const sampleCommitDays = (pid: string, repo: SampleRepo, asOf: string, days = 56): CommitDay[] => {
  const team = PROJECTS.find((p) => p.id === pid)?.team ?? [];
  const authors = team.length ? team.map((t) => t.ini) : ["??"];
  const out: CommitDay[] = [];
  const end = new Date(asOf);
  end.setUTCHours(0, 0, 0, 0);
  for (let i = 0; i < days; i++) {
    const date = new Date(end.getTime() - (days - 1 - i) * DAY);
    const dow = date.getUTCDay();
    const weekend = dow === 0 || dow === 6 ? 0.2 : 1;
    const wave = Math.sin(i / 3.2) * 0.3 + 0.7;
    const total = Math.round(rnd(hash(repo.repo) + i) * repo.level * wave * weekend + (weekend === 1 ? 1 : 0));
    if (total <= 0) continue;
    const day = date.toISOString().slice(0, 10);
    // Earlier team members commit more; keep at most three authors a day.
    let left = total;
    authors.slice(0, 3).forEach((author, ai) => {
      const share = ai === 2 ? left : Math.round(left * (ai === 0 ? 0.55 : 0.6));
      if (share > 0) out.push({ repo: repo.repo, day, author, count: share });
      left -= share;
    });
  }
  return out;
};

/** The sample facts for one project as they would look after a sync at `asOf`; null for projects without a sample. */
export const sampleDevFacts = (pid: string, asOf: string): DevFacts | null => {
  const s = DEV_SAMPLE[pid];
  if (!s) return null;
  const run: SyncRun = { source: "sample", startedAt: asOf, finishedAt: asOf, ok: true, message: `${s.repos.length} repos` };
  return sortDevFacts({
    repos: s.repos.map(({ level: _l, ...r }): RepoStat => ({ ...r, measuredAt: asOf })),
    prs: s.prs.map(({ hoursAgo, reviewHours, ...pr }): PullRequest => {
      const merged = pr.status === "merged";
      const mergedAt = merged ? iso(asOf, hoursAgo) : null;
      const openedAt = merged ? iso(asOf, hoursAgo + (reviewHours ?? 8)) : iso(asOf, hoursAgo);
      return { ...pr, openedAt, mergedAt, updatedAt: mergedAt ?? openedAt, url: `https://github.com/org/${pr.repo}/pull/${pr.number}` };
    }),
    builds: s.builds.map(({ hoursAgo, ...b }): Build => ({ ...b, startedAt: iso(asOf, hoursAgo), url: null })),
    commits: s.repos.flatMap((r) => sampleCommitDays(pid, r, asOf)),
    lastSync: run,
  });
};

export const DEV = (asOf: string): Record<string, DevFacts> =>
  Object.fromEntries(Object.keys(DEV_SAMPLE).map((pid) => [pid, sampleDevFacts(pid, asOf)]).filter((e): e is [string, DevFacts] => e[1] !== null));
