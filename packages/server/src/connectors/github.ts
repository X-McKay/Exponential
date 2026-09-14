// GitHub as a repo source: pull requests, check runs, reviews, workflow runs
// and commits through the REST API. Coverage and quality grades are not
// something GitHub knows; they stay null until another source reports them.

import { initialsOf } from "@valueflow/domain";
import type { Build, BuildKind, BuildStatus, CheckStatus, CommitDay, PullRequest, Repo, TeamMember } from "@valueflow/domain";
import type { RepoSnapshot, RepoSource, SourceContext } from "./types.ts";

export interface GitHubOptions {
  token?: string | undefined;
  apiBase?: string;
  /** Pull requests fetched per repo (each costs three extra API calls). */
  maxPrs?: number;
  maxRuns?: number;
  /** Injectable for tests. */
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
}

export class GitHubError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** "github.com/org/repo", "https://github.com/org/repo.git", or "org/repo". */
export const parseGitHubRepo = (url: string): { owner: string; repo: string } => {
  const bare = url.trim().replace(/^https?:\/\//, "").replace(/^www\./, "");
  const host = bare.split("/")[0] ?? "";
  if (host.includes(".") && host.toLowerCase() !== "github.com") throw new GitHubError(400, `not a GitHub repository url: ${url}`);
  const m = bare
    .replace(/^github\.com\//i, "")
    .replace(/\.git$/, "")
    .match(/^([\w.-]+)\/([\w.-]+)/);
  if (!m || !m[1] || !m[2]) throw new GitHubError(400, `not a GitHub repository url: ${url}`);
  return { owner: m[1], repo: m[2] };
};

// Only the fields we read, typed loosely because the API is external.
interface GhUser {
  login: string;
  name?: string | null;
}
interface GhPull {
  number: number;
  title: string;
  user: GhUser | null;
  state: "open" | "closed";
  merged_at: string | null;
  created_at: string;
  updated_at: string;
  html_url: string;
  head: { sha: string };
  requested_reviewers?: GhUser[];
  additions?: number;
  deletions?: number;
}
interface GhCheckRuns {
  check_runs: { status: string; conclusion: string | null }[];
}
interface GhReview {
  user: GhUser | null;
  state: string;
}
interface GhRuns {
  workflow_runs: {
    id: number;
    name: string | null;
    display_title?: string;
    head_branch: string | null;
    status: string | null;
    conclusion: string | null;
    run_started_at?: string;
    created_at: string;
    updated_at: string;
    html_url: string;
  }[];
}
interface GhCommit {
  sha: string;
  commit: { author: { name: string; date: string } | null };
  author: GhUser | null;
}
interface GhRepo {
  default_branch: string;
  language: string | null;
}

const norm = (s: string | null | undefined): string => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Map a GitHub identity to team initials: by name, then by login ("dank" ~ "Dan K."), then derived from the name. */
const iniFor = (team: TeamMember[], name: string | null | undefined, login: string | null | undefined): string => {
  const n = norm(name);
  const l = norm(login);
  const hit = team.find((t) => {
    const tn = norm(t.name);
    return (n !== "" && tn === n) || (l !== "" && (tn === l || t.ini.toLowerCase() === l));
  });
  if (hit) return hit.ini;
  return initialsOf(name || login || "??");
};

const checkStatus = (runs: GhCheckRuns["check_runs"]): CheckStatus => {
  if (runs.some((r) => r.conclusion === "failure" || r.conclusion === "timed_out" || r.conclusion === "cancelled")) return "fail";
  if (runs.some((r) => r.status !== "completed")) return "running";
  return "pass";
};

const buildStatus = (status: string | null, conclusion: string | null): BuildStatus => {
  if (status !== "completed") return "running";
  return conclusion === "success" || conclusion === "neutral" || conclusion === "skipped" ? "pass" : "fail";
};

const buildKind = (name: string): BuildKind => (/deploy|release|publish/i.test(name) ? "deploy" : /eval|benchmark/i.test(name) ? "eval" : "ci");

export const githubSource = (options: GitHubOptions = {}): RepoSource => {
  const base = (options.apiBase ?? "https://api.github.com").replace(/\/$/, "");
  const doFetch = options.fetch ?? fetch;
  const maxPrs = options.maxPrs ?? 20;
  const maxRuns = options.maxRuns ?? 30;

  const get = async <T>(path: string): Promise<T> => {
    const headers: Record<string, string> = { accept: "application/vnd.github+json", "user-agent": "valueflow", "x-github-api-version": "2022-11-28" };
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    const res = await doFetch(`${base}${path}`, { headers });
    if (!res.ok) throw new GitHubError(res.status, `GitHub ${res.status} for ${path}`);
    return (await res.json()) as T;
  };

  return {
    name: "github",
    fetchRepo: async (repo: Repo, ctx: SourceContext): Promise<RepoSnapshot> => {
      const { owner, repo: name } = parseGitHubRepo(repo.url);
      const r = `/repos/${owner}/${name}`;
      const since = new Date(ctx.now.getTime() - ctx.sinceDays * 86_400_000).toISOString();
      const info = await get<GhRepo>(r);

      const pulls = (await get<GhPull[]>(`${r}/pulls?state=all&sort=updated&direction=desc&per_page=${maxPrs}`)).slice(0, maxPrs);
      const prs: PullRequest[] = [];
      for (const p of pulls) {
        const [detail, checks, reviews] = await Promise.all([
          get<GhPull>(`${r}/pulls/${p.number}`),
          get<GhCheckRuns>(`${r}/commits/${p.head.sha}/check-runs`),
          get<GhReview[]>(`${r}/pulls/${p.number}/reviews`),
        ]);
        const reviewers = new Set<string>();
        for (const rv of reviews) if (rv.user) reviewers.add(iniFor(ctx.team, rv.user.name, rv.user.login));
        for (const rq of p.requested_reviewers ?? []) reviewers.add(iniFor(ctx.team, rq.name, rq.login));
        prs.push({
          repo: repo.name,
          number: p.number,
          title: p.title,
          author: iniFor(ctx.team, p.user?.name, p.user?.login),
          status: p.merged_at ? "merged" : p.state === "open" ? "open" : "closed",
          checks: checkStatus(checks.check_runs),
          add: detail.additions ?? 0,
          del: detail.deletions ?? 0,
          openedAt: p.created_at,
          mergedAt: p.merged_at,
          updatedAt: p.updated_at,
          reviewers: [...reviewers],
          url: p.html_url,
        });
      }

      const runs = await get<GhRuns>(`${r}/actions/runs?per_page=${maxRuns}`);
      const builds: Build[] = runs.workflow_runs
        .filter((w) => w.created_at >= since)
        .map((w) => {
          const started = w.run_started_at ?? w.created_at;
          const label = w.name ?? "workflow";
          return {
            repo: repo.name,
            id: String(w.id),
            branch: w.head_branch ?? "",
            kind: buildKind(label),
            status: buildStatus(w.status, w.conclusion),
            note: w.display_title && w.display_title !== label ? `${label} · ${w.display_title}` : label,
            startedAt: started,
            durationS: Math.max(0, Math.round((new Date(w.updated_at).getTime() - new Date(started).getTime()) / 1000)),
            url: w.html_url,
          };
        });

      const counts = new Map<string, CommitDay>();
      for (let page = 1; page <= 3; page++) {
        const commits = await get<GhCommit[]>(`${r}/commits?sha=${encodeURIComponent(info.default_branch)}&since=${encodeURIComponent(since)}&per_page=100&page=${page}`);
        for (const c of commits) {
          const date = c.commit.author?.date;
          if (!date) continue;
          const day = date.slice(0, 10);
          const author = iniFor(ctx.team, c.commit.author?.name, c.author?.login);
          const key = `${day} ${author}`;
          const row = counts.get(key) ?? { repo: repo.name, day, author, count: 0 };
          row.count += 1;
          counts.set(key, row);
        }
        if (commits.length < 100) break;
      }

      return {
        stat: { repo: repo.name, branch: info.default_branch, lang: info.language, coverage: null, quality: null, measuredAt: ctx.now.toISOString() },
        prs,
        builds,
        commits: [...counts.values()],
      };
    },
  };
};
