import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const filesRendererDir = join(ROOT, "src/plugins/builtin/files/renderer");
const builtinPluginsDir = join(ROOT, "src/plugins/builtin");

function listTsSources(dir: string): string[] {
  return readdirSync(dir, { encoding: "utf8", recursive: true })
    .filter((file) => /\.(?:ts|tsx)$/.test(file))
    .map((file) => join(dir, file));
}

describe("files tree search loader removal", () => {
  it("does not keep the whole-tree search loader module", () => {
    expect(
      existsSync(join(filesRendererDir, "files-tree-search-loader.ts"))
    ).toBe(false);
  });

  it("does not reintroduce loadFilesTreeForSearch in files renderer sources", () => {
    const sources = listTsSources(filesRendererDir)
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    expect(sources).not.toContain("loadFilesTreeForSearch");
    expect(sources).not.toContain("files-tree-search-loader");
  });
});

describe("builtin plugin files API governance", () => {
  it("forbids builtin plugins from calling deprecated files.readText/writeText", () => {
    const offenders: string[] = [];
    for (const absolute of listTsSources(builtinPluginsDir)) {
      const text = readFileSync(absolute, "utf8");
      if (
        /(?:context|files)\.files\.(?:readText|writeText)\(/.test(text) ||
        /\.files\.(?:readText|writeText)\(/.test(text)
      ) {
        // Allow comments mentioning the deprecated names in governance-facing docs strings only
        // via the stricter call-site pattern above.
        offenders.push(absolute.slice(ROOT.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });
});
