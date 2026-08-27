import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ProjectIdentity {
  canonicalRoot: string;
  key: string;
}

function sha16(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

/** git 项目用 commonDir（worktree 收敛同一仓库身份）；非 git 退化为目录 identity。 */
export async function resolveProjectIdentity(
  projectRootPath: string
): Promise<ProjectIdentity> {
  const root = await realpath(projectRootPath);
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["rev-parse", "--git-common-dir"],
      {
        cwd: root,
        encoding: "utf8",
      }
    );
    const commonDirLine = stdout
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean);
    if (!commonDirLine) {
      return { canonicalRoot: root, key: sha16(root) };
    }
    const commonDir = await realpath(resolve(root, commonDirLine));
    return { canonicalRoot: commonDir, key: sha16(commonDir) };
  } catch {
    return { canonicalRoot: root, key: sha16(root) };
  }
}
