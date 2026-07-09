import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const SOURCE_FILE_RE = /\.(ts|tsx)$/;
const IMPORT_RE =
  /(?:^|\n)\s*(?:import|export)\s+[^"']*from\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;

async function collectSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        return collectSourceFiles(path);
      }
      return SOURCE_FILE_RE.test(entry.name) ? [path] : [];
    })
  );
  return files.flat();
}

interface ScanResult {
  files: readonly string[];
  imports: readonly { file: string; specifier: string }[];
}

async function scanImports(
  dir: string,
  options: { allowMissing?: boolean } = {}
): Promise<ScanResult> {
  const absoluteDir = join(REPO_ROOT, dir);
  if (!existsSync(absoluteDir)) {
    if (options.allowMissing) {
      return { files: [], imports: [] };
    }
    throw new Error(`scanImports: ${dir} does not exist`);
  }
  const files = await collectSourceFiles(absoluteDir);
  const imports: { file: string; specifier: string }[] = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(IMPORT_RE)) {
      const specifier = match[1] ?? match[2];
      if (specifier) {
        imports.push({ file: relative(REPO_ROOT, file), specifier });
      }
    }
  }
  return { files: files.map((f) => relative(REPO_ROOT, f)), imports };
}

describe("plugin api / plugin codex package boundaries", () => {
  it("packages/plugin-api does not import app internals or builtin plugins", async () => {
    const result = await scanImports("packages/plugin-api/src", {
      allowMissing: true,
    });
    const violations = result.imports.filter((entry) =>
      /^src\/main|^src\/renderer|plugins\/builtin|^@plugins\/builtin/.test(
        entry.specifier
      )
    );
    expect(violations).toEqual([]);
  });

  it("packages/plugin-codex does not import app internals", async () => {
    const result = await scanImports("packages/plugin-codex/src", {
      allowMissing: true,
    });
    const violations = result.imports.filter((entry) =>
      /^src\/|^@shared\/|^@main\/|^@renderer\/|^@plugins\//.test(
        entry.specifier
      )
    );
    expect(violations).toEqual([]);
  });

  it("src/** does not statically import external plugin implementation sources", async () => {
    const result = await scanImports("src");
    const violations = result.imports.filter((entry) =>
      /packages\/plugin-codex\/src|@pier\/plugin-codex\/src/.test(
        entry.specifier
      )
    );
    expect(violations).toEqual([]);
  });
});
