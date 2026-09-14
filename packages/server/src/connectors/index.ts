import { githubSource } from "./github.ts";
import { sampleSource } from "./sample.ts";
import type { RepoSource } from "./types.ts";

export type { RepoSnapshot, RepoSource, SourceContext } from "./types.ts";
export { githubSource, parseGitHubRepo, GitHubError } from "./github.ts";
export { sampleSource } from "./sample.ts";

export const SOURCE_NAMES = ["none", "sample", "github"] as const;
export type SourceName = (typeof SOURCE_NAMES)[number];

/**
 * `SYNC_SOURCE=sample|github|none` picks the source; `GITHUB_TOKEN` authenticates
 * the GitHub API (unauthenticated calls are limited to 60 an hour).
 */
export const sourceFromEnv = (env: Record<string, string | undefined>): RepoSource | null => {
  const name = env.SYNC_SOURCE ?? "none";
  switch (name) {
    case "none":
      return null;
    case "sample":
      return sampleSource();
    case "github":
      return githubSource({ token: env.GITHUB_TOKEN });
    default:
      throw new Error(`SYNC_SOURCE must be one of ${SOURCE_NAMES.join(", ")}; got ${name}`);
  }
};
