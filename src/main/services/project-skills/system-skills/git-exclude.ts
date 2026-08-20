import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const SYSTEM_SKILL_GIT_EXCLUDE_BEGIN = "# pier-system-skills";

export const SYSTEM_SKILL_GIT_EXCLUDE_LINES = [
  SYSTEM_SKILL_GIT_EXCLUDE_BEGIN,
  ".pier/skills/library/pier-*/",
  ".pier/skills/library/.pier-system-skill-*",
  ".agents/skills/pier-*",
  ".claude/skills/pier-*",
] as const;

function excludeBlock(): string {
  return `${SYSTEM_SKILL_GIT_EXCLUDE_LINES.join("\n")}\n`;
}

async function resolveExcludePath(projectRoot: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", projectRoot, "rev-parse", "--git-path", "info/exclude"],
      { timeout: 5000 }
    );
    const raw = stdout.trim();
    if (!raw) return null;
    return isAbsolute(raw) ? raw : join(projectRoot, raw);
  } catch {
    return null;
  }
}

/**
 * Local-only git exclude for product-skill discovery links and retired
 * library snapshots. Does not edit the team's `.gitignore`.
 */
export async function ensureSystemSkillGitExclude(
  projectRoot: string
): Promise<void> {
  const excludePath = await resolveExcludePath(projectRoot);
  if (!excludePath) return;
  let existing = "";
  try {
    existing = await readFile(excludePath, "utf8");
  } catch {
    existing = "";
  }
  if (existing.includes(SYSTEM_SKILL_GIT_EXCLUDE_BEGIN)) {
    return;
  }
  await mkdir(dirname(excludePath), { recursive: true });
  const prefix = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
  await writeFile(excludePath, `${existing}${prefix}${excludeBlock()}`, {
    encoding: "utf8",
  });
}
