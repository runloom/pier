import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const IMPORT_RE =
  /(?:^|\n)\s*(?:import|export)\s+[^"']*from\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;

async function collectSources(dir: string): Promise<string[]> {
  if (!existsSync(dir)) {
    return [];
  }
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSources(p)));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(p);
    }
  }
  return files;
}

async function scanImports(
  dir: string
): Promise<{ file: string; specifier: string }[]> {
  const files = await collectSources(join(REPO_ROOT, dir));
  const imports: { file: string; specifier: string }[] = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(IMPORT_RE)) {
      const spec = match[1] ?? match[2];
      if (spec) {
        imports.push({ file, specifier: spec });
      }
    }
  }
  return imports;
}

describe("external plugin package boundaries", () => {
  it("packages/plugin-codex/src never imports host internals", async () => {
    const imports = await scanImports("packages/plugin-codex/src");
    const violations = imports.filter((entry) =>
      /^src\/|^@shared\/|^@main\/|^@renderer\/|^@plugins\//.test(
        entry.specifier
      )
    );
    expect(violations).toEqual([]);
  });

  it("packages/plugin-api/src never imports host internals", async () => {
    const imports = await scanImports("packages/plugin-api/src");
    const violations = imports.filter((entry) =>
      /^src\/main|^src\/renderer|plugins\/builtin|^@plugins\/builtin/.test(
        entry.specifier
      )
    );
    expect(violations).toEqual([]);
  });

  it("src/** never statically imports @pier/plugin-codex/src", async () => {
    const imports = await scanImports("src");
    const violations = imports.filter((entry) =>
      /packages\/plugin-codex\/src|@pier\/plugin-codex\/src/.test(
        entry.specifier
      )
    );
    expect(violations).toEqual([]);
  });

  it("packages/plugin-codex/src only imports @pier/plugin-api, plugin-local, or bundled third-party (never host internals)", async () => {
    const imports = await scanImports("packages/plugin-codex/src");
    const violations = imports.filter((entry) => {
      const spec = entry.specifier;
      if (spec.startsWith(".")) {
        return false;
      }
      if (spec.startsWith("node:")) {
        return false;
      }
      // Host internals — explicitly forbidden.
      if (/^src\/|^@shared\/|^@main\/|^@renderer\/|^@plugins\//.test(spec)) {
        return true;
      }
      // Everything else is a bundled dependency; plugin build will inline.
      return false;
    });
    expect(violations).toEqual([]);
  });
});
