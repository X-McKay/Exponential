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
  onboarding: {
    repos: [
      { repo: "onboarding-mapping-svc", branch: "main", coverage: 88, quality: "A", lang: "Python", level: 9 },
      { repo: "doc-ingest-pipeline", branch: "main", coverage: 79, quality: "B+", lang: "Python", level: 8 },
      { repo: "onboarding-evals", branch: "main", coverage: 91, quality: "A", lang: "Python", level: 4 },
    ],
    prs: [
      { repo: "doc-ingest-pipeline", number: 412, title: "Add drift alert thresholds to ingest metrics", author: "RS", status: "open", checks: "running", add: 214, del: 38, hoursAgo: 3, reviewers: ["NP"] },
      { repo: "doc-ingest-pipeline", number: 409, title: "Batch OCR fallback for scanned custodian statements", author: "DK", status: "open", checks: "fail", add: 486, del: 92, hoursAgo: 26, reviewers: ["AM", "NP"] },
      { repo: "onboarding-mapping-svc", number: 408, title: "Mapping suggestion confidence calibration", author: "DK", status: "merged", checks: "pass", add: 167, del: 41, hoursAgo: 48, reviewHours: 5, reviewers: ["AM"] },
      { repo: "onboarding-evals", number: 71, title: "Golden set v5: add 2 new custodian formats", author: "AM", status: "merged", checks: "pass", add: 1240, del: 12, hoursAgo: 72, reviewHours: 3, reviewers: ["DK"] },
      { repo: "onboarding-mapping-svc", number: 405, title: "Refactor: extract schema inference into module", author: "NP", status: "merged", checks: "pass", add: 623, del: 587, hoursAgo: 96, reviewHours: 9, reviewers: ["DK", "RS"] },
      { repo: "onboarding-mapping-svc", number: 401, title: "Retry policy for custodian API timeouts", author: "RS", status: "merged", checks: "pass", add: 88, del: 20, hoursAgo: 190, reviewHours: 4, reviewers: ["NP"] },
      { repo: "doc-ingest-pipeline", number: 398, title: "Streaming parser for multi-page statements", author: "DK", status: "merged", checks: "pass", add: 702, del: 133, hoursAgo: 300, reviewHours: 14, reviewers: ["AM", "NP"] },
      { repo: "onboarding-evals", number: 68, title: "Per-custodian breakdown in eval report", author: "AM", status: "merged", checks: "pass", add: 210, del: 31, hoursAgo: 420, reviewHours: 2, reviewers: ["DK"] },
    ],
    builds: [
      { repo: "doc-ingest-pipeline", id: "#1148", branch: "pr/409", kind: "ci", status: "fail", note: "test_ocr_fallback: 3 failures", hoursAgo: 2, durationS: 372 },
      { repo: "onboarding-mapping-svc", id: "#1147", branch: "main", kind: "deploy", status: "pass", note: "deploy → staging", hoursAgo: 5, durationS: 280 },
      { repo: "onboarding-evals", id: "#1146", branch: "main", kind: "eval", status: "pass", note: "nightly eval run · gates green", hoursAgo: 9, durationS: 1323 },
      { repo: "doc-ingest-pipeline", id: "#1145", branch: "main", kind: "deploy", status: "pass", note: "deploy → prod (canary)", hoursAgo: 26, durationS: 471 },
      { repo: "onboarding-mapping-svc", id: "#1144", branch: "main", kind: "ci", status: "pass", note: "unit + contract tests", hoursAgo: 30, durationS: 251 },
      { repo: "doc-ingest-pipeline", id: "#1143", branch: "pr/412", kind: "ci", status: "pass", note: "unit tests", hoursAgo: 40, durationS: 301 },
      { repo: "onboarding-mapping-svc", id: "#1142", branch: "main", kind: "deploy", status: "pass", note: "deploy → prod", hoursAgo: 75, durationS: 455 },
      { repo: "onboarding-evals", id: "#1141", branch: "main", kind: "eval", status: "pass", note: "nightly eval run · gates green", hoursAgo: 81, durationS: 1290 },
    ],
  },
  ima: {
    repos: [
      { repo: "ima-rule-extractor", branch: "main", coverage: 74, quality: "B+", lang: "Python", level: 6 },
      { repo: "compliance-rule-schema", branch: "main", coverage: 82, quality: "A−", lang: "Rust", level: 3 },
    ],
    prs: [
      { repo: "ima-rule-extractor", number: 188, title: "Recall improvements: nested restriction clauses", author: "DK", status: "open", checks: "pass", add: 342, del: 118, hoursAgo: 6, reviewers: ["AM", "SC"] },
      { repo: "compliance-rule-schema", number: 186, title: "Schema v0.9: derivative exposure limits", author: "AM", status: "open", checks: "pass", add: 156, del: 22, hoursAgo: 50, reviewers: ["SC"] },
      { repo: "ima-rule-extractor", number: 184, title: "Add SME disagreement flags to eval output", author: "DK", status: "merged", checks: "pass", add: 98, del: 14, hoursAgo: 74, reviewHours: 11, reviewers: ["SC"] },
      { repo: "ima-rule-extractor", number: 181, title: "Dual-approval state machine for rule activation", author: "AM", status: "merged", checks: "pass", add: 411, del: 63, hoursAgo: 150, reviewHours: 20, reviewers: ["SC", "MB"] },
      { repo: "compliance-rule-schema", number: 179, title: "Validate restriction scopes against IMA taxonomy", author: "AM", status: "merged", checks: "pass", add: 133, del: 40, hoursAgo: 330, reviewHours: 8, reviewers: ["SC"] },
    ],
    builds: [
      { repo: "ima-rule-extractor", id: "#402", branch: "main", kind: "eval", status: "pass", note: "eval run · recall 86% (below gate)", hoursAgo: 4, durationS: 1904 },
      { repo: "compliance-rule-schema", id: "#401", branch: "main", kind: "ci", status: "pass", note: "schema validation suite", hoursAgo: 25, durationS: 138 },
      { repo: "ima-rule-extractor", id: "#400", branch: "pr/185", kind: "ci", status: "fail", note: "clause splitter regression", hoursAgo: 49, durationS: 1689 },
      { repo: "ima-rule-extractor", id: "#399", branch: "main", kind: "ci", status: "pass", note: "unit + golden set", hoursAgo: 70, durationS: 1520 },
      { repo: "ima-rule-extractor", id: "#398", branch: "main", kind: "deploy", status: "pass", note: "deploy → shadow", hoursAgo: 160, durationS: 610 },
    ],
  },
  sector: {
    repos: [{ repo: "sector-report-agents", branch: "main", coverage: 58, quality: "B", lang: "Python", level: 4 }],
    prs: [
      { repo: "sector-report-agents", number: 54, title: "Citation verifier agent with source pinning", author: "DK", status: "open", checks: "running", add: 388, del: 45, hoursAgo: 25, reviewers: ["AM"] },
      { repo: "sector-report-agents", number: 52, title: "Rubric scoring harness for analyst evals", author: "TW", status: "open", checks: "pass", add: 205, del: 0, hoursAgo: 49, reviewers: ["DK"] },
      { repo: "sector-report-agents", number: 49, title: "Draft outline planner: sector template library", author: "DK", status: "merged", checks: "pass", add: 512, del: 88, hoursAgo: 120, reviewHours: 26, reviewers: ["AM", "TW"] },
      { repo: "sector-report-agents", number: 45, title: "Market data fixtures for offline evals", author: "TW", status: "merged", checks: "pass", add: 260, del: 9, hoursAgo: 260, reviewHours: 30, reviewers: ["DK"] },
    ],
    builds: [
      { repo: "sector-report-agents", id: "#96", branch: "main", kind: "ci", status: "fail", note: "flaky: market data fixture timeout", hoursAgo: 7, durationS: 750 },
      { repo: "sector-report-agents", id: "#95", branch: "main", kind: "ci", status: "pass", note: "unit + rubric smoke tests", hoursAgo: 27, durationS: 542 },
      { repo: "sector-report-agents", id: "#94", branch: "pr/52", kind: "ci", status: "pass", note: "unit tests", hoursAgo: 50, durationS: 501 },
      { repo: "sector-report-agents", id: "#93", branch: "main", kind: "ci", status: "fail", note: "rubric harness import error", hoursAgo: 120, durationS: 88 },
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
