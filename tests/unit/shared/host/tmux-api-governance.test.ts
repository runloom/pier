import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SOURCE_FILE_RE = /\.(js|jsx|mjs|ts|tsx)$/;
const SKIPPED_DIRECTORIES = new Set([
  "build",
  "coverage",
  "dist",
  "docs",
  "node_modules",
  "out",
  "tests",
]);
const SCAN_ROOTS = [
  "src/main",
  "src/shared",
  "src/renderer",
  "packages/plugin-api",
];
const FORBIDDEN = [
  { id: "TMUX", re: /\bTMUX\b/u },
  { id: "main-vertical", re: /\bmain-vertical\b/u },
  { id: "tiled", re: /\btiled\b/u },
];

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const filePath = join(dir, entry);
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry)) {
        files.push(...sourceFiles(filePath));
      }
      continue;
    }
    if (
      SOURCE_FILE_RE.test(entry) &&
      !entry.includes(".test.") &&
      !filePath.includes(`${sep}fixtures${sep}`)
    ) {
      files.push(filePath);
    }
  }
  return files;
}

describe("host API has no tmux vocabulary", () => {
  it("does not use TMUX, main-vertical, or tiled in host source", () => {
    const hits: string[] = [];
    for (const root of SCAN_ROOTS) {
      for (const filePath of sourceFiles(join(ROOT, root))) {
        const text = readFileSync(filePath, "utf8");
        for (const rule of FORBIDDEN) {
          if (rule.re.test(text)) {
            hits.push(`${relative(ROOT, filePath)}: ${rule.id}`);
          }
        }
      }
    }
    expect(hits).toEqual([]);
  });
});
