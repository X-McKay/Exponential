// The GitHub source against canned API responses: proves the mapping from
// pulls, check runs, reviews, workflow runs, and commits into development facts
// without touching the network.

import { describe, expect, test } from "bun:test";
import { GitHubError, githubSource, parseGitHubRepo } from "../src/connectors/index.ts";

const NOW = new Date("2026-09-10T09:00:00Z");
const TEAM = [
  { ini: "AM", name: "Al McKay", role: "Lead" },
  { ini: "DK", name: "Dan K.", role: "ML Engineer" },
];

const canned: Record<string, unknown> = {
  "/repos/org/widget": { default_branch: "main", language: "TypeScript" },
  "/repos/org/widget/pulls?state=all&sort=updated&direction=desc&per_page=20": [
    {
      number: 12,
      title: "Add widget",
      user: { login: "almckay", name: "Al McKay" },
      state: "open",
      merged_at: null,
      created_at: "2026-09-09T08:00:00Z",
      updated_at: "2026-09-10T08:00:00Z",
      html_url: "https://github.com/org/widget/pull/12",
      head: { sha: "abc" },
      requested_reviewers: [{ login: "dank" }],
    },
    {
      number: 11,
      title: "Fix build",
      user: { login: "somebody" },
      state: "closed",
      merged_at: "2026-09-08T12:00:00Z",
      created_at: "2026-09-07T12:00:00Z",
      updated_at: "2026-09-08T12:00:00Z",
      html_url: "https://github.com/org/widget/pull/11",
      head: { sha: "def" },
    },
  ],
  "/repos/org/widget/pulls/12": { additions: 120, deletions: 4 },
  "/repos/org/widget/pulls/11": { additions: 10, deletions: 2 },
  "/repos/org/widget/commits/abc/check-runs": { check_runs: [{ status: "completed", conclusion: "failure" }, { status: "in_progress", conclusion: null }] },
  "/repos/org/widget/commits/def/check-runs": { check_runs: [{ status: "completed", conclusion: "success" }] },
  "/repos/org/widget/pulls/12/reviews": [{ user: { login: "dank", name: "Dan K." }, state: "CHANGES_REQUESTED" }],
  "/repos/org/widget/pulls/11/reviews": [],
  "/repos/org/widget/actions/runs?per_page=30": {
    workflow_runs: [
      { id: 900, name: "CI", display_title: "Add widget", head_branch: "feature/widget", status: "completed", conclusion: "failure", run_started_at: "2026-09-10T07:00:00Z", created_at: "2026-09-10T07:00:00Z", updated_at: "2026-09-10T07:06:12Z", html_url: "https://github.com/org/widget/actions/runs/900" },
      { id: 899, name: "Deploy to staging", head_branch: "main", status: "completed", conclusion: "success", run_started_at: "2026-09-09T07:00:00Z", created_at: "2026-09-09T07:00:00Z", updated_at: "2026-09-09T07:04:40Z", html_url: "https://github.com/org/widget/actions/runs/899" },
      { id: 1, name: "CI", head_branch: "main", status: "completed", conclusion: "success", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:01:00Z", html_url: "" },
    ],
  },
};

const fakeFetch = (input: string): Promise<Response> => {
  const url = new URL(String(input));
  const path = url.pathname + url.search;
  if (path.startsWith("/repos/org/widget/commits?")) {
    const body = [
      { sha: "1", commit: { author: { name: "Al McKay", date: "2026-09-10T06:00:00Z" } }, author: { login: "almckay" } },
      { sha: "2", commit: { author: { name: "Al McKay", date: "2026-09-10T05:00:00Z" } }, author: { login: "almckay" } },
      { sha: "3", commit: { author: { name: "Jane Roe", date: "2026-09-09T05:00:00Z" } }, author: null },
    ];
    return Promise.resolve(Response.json(body));
  }
  const hit = canned[path];
  return Promise.resolve(hit === undefined ? new Response("nope", { status: 404 }) : Response.json(hit));
};

describe("GitHub source", () => {
  test("parses repository urls in every common shape", () => {
    expect(parseGitHubRepo("github.com/org/widget")).toEqual({ owner: "org", repo: "widget" });
    expect(parseGitHubRepo("https://github.com/org/widget.git")).toEqual({ owner: "org", repo: "widget" });
    expect(parseGitHubRepo("org/widget")).toEqual({ owner: "org", repo: "widget" });
    expect(() => parseGitHubRepo("gitlab.com/x")).toThrow(GitHubError);
  });

  test("maps pulls, checks, reviews, runs, and commits into facts", async () => {
    const source = githubSource({ fetch: fakeFetch, token: "t" });
    const snap = await source.fetchRepo({ name: "widget", url: "github.com/org/widget" }, { projectId: "p", now: NOW, sinceDays: 56, team: TEAM });
    expect(snap.stat).toEqual({ repo: "widget", branch: "main", lang: "TypeScript", coverage: null, quality: null, measuredAt: NOW.toISOString() });
    expect(snap.prs).toEqual([
      { repo: "widget", number: 12, title: "Add widget", author: "AM", status: "open", checks: "fail", add: 120, del: 4, openedAt: "2026-09-09T08:00:00Z", mergedAt: null, updatedAt: "2026-09-10T08:00:00Z", reviewers: ["DK"], url: "https://github.com/org/widget/pull/12" },
      { repo: "widget", number: 11, title: "Fix build", author: "SO", status: "merged", checks: "pass", add: 10, del: 2, openedAt: "2026-09-07T12:00:00Z", mergedAt: "2026-09-08T12:00:00Z", updatedAt: "2026-09-08T12:00:00Z", reviewers: [], url: "https://github.com/org/widget/pull/11" },
    ]);
    expect(snap.builds.map((b) => [b.id, b.kind, b.status, b.durationS, b.note])).toEqual([
      ["900", "ci", "fail", 372, "CI · Add widget"],
      ["899", "deploy", "pass", 280, "Deploy to staging"],
    ]);
    expect(snap.commits).toEqual([
      { repo: "widget", day: "2026-09-10", author: "AM", count: 2 },
      { repo: "widget", day: "2026-09-09", author: "JR", count: 1 },
    ]);
  });

  test("surfaces API failures with their status", async () => {
    const source = githubSource({ fetch: () => Promise.resolve(new Response("rate limited", { status: 403 })) });
    await expect(source.fetchRepo({ name: "x", url: "github.com/org/x" }, { projectId: "p", now: NOW, sinceDays: 7, team: [] })).rejects.toThrow("GitHub 403");
  });
});
