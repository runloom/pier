import { realpath, stat } from "node:fs/promises";
import path from "node:path";

export type GitCwdExec = (
  args: readonly string[],
  cwd: string
) => Promise<string>;

export async function validateGitCwd(
  execGit: GitCwdExec,
  cwd: string
): Promise<null | string> {
  if (!(cwd && path.isAbsolute(cwd)) || cwd.includes("\0")) {
    return null;
  }
  try {
    const resolved = await realpath(cwd);
    const info = await stat(resolved);
    if (!info.isDirectory()) {
      return null;
    }
    const root = (
      await execGit(["rev-parse", "--show-toplevel"], resolved)
    ).trim();
    return root || null;
  } catch {
    return null;
  }
}
