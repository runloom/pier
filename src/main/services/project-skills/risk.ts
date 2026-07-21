import type { Stats } from "node:fs";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { parseSafeSkillFrontmatter } from "./frontmatter.ts";
import { buildDirectorySummary } from "./import-limits.ts";
import {
  collectDynamicCommandTraces,
  computeRiskFingerprint,
  extractRiskFrontmatter,
} from "./tree-digest.ts";

/**
 * Library risk analysis (design v8 §3.2 / §3.4): production resolver for the
 * risk fingerprint plus the renderer-facing risk summary and size facts.
 * Bounded read-only walk of `.pier/skills/library/<id>`; failures degrade to
 * null (callers treat missing risk facts as "not analyzable", never block
 * read paths on it).
 */

const MAX_FILES = 2000;
const MAX_FILE_BYTES = 16 * 1024 * 1024;

export interface LibrarySkillAnalysis {
  /** Same breakdown as import candidates (design §7.5: no source gets an
   * abbreviated review). */
  directorySummary: {
    skillMd: boolean;
    scripts: number;
    references: number;
    assets: number;
    otherFiles: number;
  };
  fileCount: number;
  riskFingerprint: string;
  riskSummary: {
    executables: string[];
    dynamicCommandTraces: string[];
    riskFrontmatter: Record<string, unknown>;
  };
  totalBytes: number;
}

interface WalkedFile {
  bytes: Buffer;
  executable: boolean;
  relativePath: string;
}

async function walkLibraryTree(rootDir: string): Promise<WalkedFile[] | null> {
  const files: WalkedFile[] = [];

  async function walk(dir: string, relative: string): Promise<boolean> {
    let children: string[];
    try {
      children = await readdir(dir);
    } catch {
      return false;
    }
    children.sort();
    for (const child of children) {
      const absolute = join(dir, child);
      const rel = relative === "" ? child : posix.join(relative, child);
      let info: Stats;
      try {
        info = await lstat(absolute);
      } catch {
        return false;
      }
      // Library snapshots never contain symlinks/special files; treat any as
      // unanalyzable rather than following them.
      if (info.isSymbolicLink()) return false;
      if (info.isDirectory()) {
        const ok = await walk(absolute, rel);
        if (!ok) return false;
        continue;
      }
      if (!info.isFile()) return false;
      if (files.length >= MAX_FILES) return false;
      if (info.size > MAX_FILE_BYTES) return false;
      let bytes: Buffer;
      try {
        bytes = await readFile(absolute);
      } catch {
        return false;
      }
      files.push({
        relativePath: rel,
        // biome-ignore lint/suspicious/noBitwiseOperators: POSIX mode mask
        executable: (info.mode & 0o111) !== 0,
        bytes,
      });
    }
    return true;
  }

  const ok = await walk(rootDir, "");
  return ok ? files : null;
}

export async function analyzeLibrarySkill(
  projectRoot: string,
  skillId: string
): Promise<LibrarySkillAnalysis | null> {
  const libraryDir = join(projectRoot, ".pier", "skills", "library", skillId);
  try {
    const info = await lstat(libraryDir);
    if (!info.isDirectory() || info.isSymbolicLink()) return null;
  } catch {
    return null;
  }
  const files = await walkLibraryTree(libraryDir);
  if (!files) return null;

  const skillMd = files.find((f) => f.relativePath === "SKILL.md");
  let frontmatter: Record<string, unknown> = {};
  if (skillMd) {
    try {
      frontmatter = parseSafeSkillFrontmatter(
        skillMd.bytes.toString("utf8")
      ).frontmatter;
    } catch {
      frontmatter = {};
    }
  }

  const riskFingerprint = computeRiskFingerprint({
    treeFiles: files,
    frontmatter,
  });
  const executables = files
    .filter((f) => f.executable)
    .map((f) => f.relativePath)
    .sort();

  return {
    riskFingerprint,
    riskSummary: {
      executables,
      dynamicCommandTraces: collectDynamicCommandTraces(files),
      riskFrontmatter: extractRiskFrontmatter(frontmatter),
    },
    directorySummary: buildDirectorySummary(files),
    fileCount: files.length,
    totalBytes: files.reduce((sum, f) => sum + f.bytes.length, 0),
  };
}
