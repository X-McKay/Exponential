// The sample source materialises the fixtures' development activity relative
// to the current clock. Projects without a sample get generated commit
// history and nothing else, so the pages still have something to show.

import { DEV_SAMPLE, sampleCommitDays, sampleDevFacts } from "@valueflow/domain";
import type { Repo } from "@valueflow/domain";
import type { RepoSnapshot, RepoSource, SourceContext } from "./types.ts";

export const sampleSource = (): RepoSource => ({
  name: "sample",
  fetchRepo: (repo: Repo, ctx: SourceContext): Promise<RepoSnapshot> => {
    const asOf = ctx.now.toISOString();
    const facts = sampleDevFacts(ctx.projectId, asOf);
    const stat = facts?.repos.find((r) => r.repo === repo.name);
    if (facts && stat) {
      return Promise.resolve({
        stat,
        prs: facts.prs.filter((pr) => pr.repo === repo.name),
        builds: facts.builds.filter((b) => b.repo === repo.name),
        commits: facts.commits.filter((c) => c.repo === repo.name),
      });
    }
    const level = 2 + (repo.name.length % 4);
    return Promise.resolve({
      stat: { repo: repo.name, branch: "main", lang: null, coverage: null, quality: null, measuredAt: asOf },
      prs: [],
      builds: [],
      commits: sampleCommitDays(ctx.projectId in DEV_SAMPLE ? ctx.projectId : "invoice", { repo: repo.name, branch: "main", lang: null, coverage: null, quality: null, level }, asOf, ctx.sinceDays),
    });
  },
});
