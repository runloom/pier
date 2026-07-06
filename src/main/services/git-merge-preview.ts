const GIT_TREE_OID_RE = /^[0-9a-f]{40,64}$/i;
const LINE_SPLIT_RE = /\r?\n/;
const MERGE_PREVIEW_TIMEOUT_MS = 2000;

export type GitMergePreviewExec = (
  args: readonly string[],
  cwd: string,
  options?: { timeoutMs?: number }
) => Promise<string>;

function firstOidLine(output: string): string | null {
  const line = output.trim().split(LINE_SPLIT_RE, 1)[0]?.trim() ?? "";
  return GIT_TREE_OID_RE.test(line) ? line : null;
}

export async function mergeWouldKeepHeadTree(
  execGit: GitMergePreviewExec,
  cwd: string,
  targetRef: string
): Promise<boolean> {
  if (targetRef.startsWith("-")) {
    return false;
  }
  try {
    const [headTreeOutput, mergeTreeOutput] = await Promise.all([
      execGit(["rev-parse", "HEAD^{tree}"], cwd, {
        timeoutMs: MERGE_PREVIEW_TIMEOUT_MS,
      }),
      execGit(["merge-tree", "--write-tree", "HEAD", targetRef], cwd, {
        timeoutMs: MERGE_PREVIEW_TIMEOUT_MS,
      }),
    ]);
    const headTree = firstOidLine(headTreeOutput);
    const mergeTree = firstOidLine(mergeTreeOutput);
    return headTree !== null && headTree === mergeTree;
  } catch {
    return false;
  }
}
