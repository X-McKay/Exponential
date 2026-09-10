// ================= repo sources =================
//
// A source turns one repository into development facts. The sync job asks
// the configured source for each of a project's repositories and replaces
// the project's facts wholesale, so a source never needs to diff.

import type { Build, CommitDay, Repo, RepoStat, TeamMember } from "@valueflow/domain";
import type { PullRequest } from "@valueflow/domain";

export interface RepoSnapshot {
  stat: RepoStat;
  prs: PullRequest[];
  builds: Build[];
  commits: CommitDay[];
}

export interface SourceContext {
  projectId: string;
  /** The clock; every timestamp is relative to it. */
  now: Date;
  /** How far back to fetch commits and builds. */
  sinceDays: number;
  /** Used to map authors to initials. */
  team: TeamMember[];
}

export interface RepoSource {
  /** Short name recorded on every sync run ("sample", "github"). */
  name: string;
  fetchRepo: (repo: Repo, ctx: SourceContext) => Promise<RepoSnapshot>;
}
