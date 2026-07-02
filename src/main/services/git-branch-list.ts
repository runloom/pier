import type { GitBranchRef } from "../../shared/contracts/git.ts";
import { parseGitBranchRefs } from "./git-parsers.ts";

export type GitBranchListExec = (
  args: readonly string[],
  cwd: string
) => Promise<string>;

export interface GitBranchListOptions {
  kind: "all" | "local" | "remote";
}

export async function listBranches(
  execGit: GitBranchListExec,
  cwd: string,
  options: GitBranchListOptions
): Promise<GitBranchRef[]> {
  const refs = ["refs/heads", "refs/remotes"].filter((ref) => {
    if (options.kind === "local") {
      return ref === "refs/heads";
    }
    if (options.kind === "remote") {
      return ref === "refs/remotes";
    }
    return true;
  });
  const output = await execGit(
    [
      "for-each-ref",
      "--sort=-committerdate",
      "--format=%(refname)%00%(upstream:short)%00%(objectname)%00%(HEAD)",
      ...refs,
    ],
    cwd
  );
  return parseGitBranchRefs(output);
}
