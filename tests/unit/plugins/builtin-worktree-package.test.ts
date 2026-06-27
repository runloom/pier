import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const WORKTREE_PLUGIN_DIR = join(process.cwd(), "src/plugins/builtin/worktree");
const SOURCE_FILE_RE = /\.(ts|tsx)$/;
const HOST_REGISTRY_RE =
  /actionRegistry|terminalStatusItemRegistry|useCommandPaletteController|usePanelDescriptorStore/;
const DEEP_HOST_CONTRACT_RE =
  /\.\.\/\.\.\/\.\.\/api|\.\.\/\.\.\/\.\.\/\.\.\/shared/;
const LEGACY_KEYWORDS_RE = /\bkeywords\s*:/;

async function collectSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        return await collectSourceFiles(path);
      }
      return SOURCE_FILE_RE.test(entry.name) ? [path] : [];
    })
  );
  return files.flat();
}

describe("builtin worktree plugin package boundary", () => {
  it("does not import host process implementation modules", async () => {
    const files = await collectSourceFiles(WORKTREE_PLUGIN_DIR);
    const sources = await Promise.all(
      files.map(async (file) => ({
        file: relative(process.cwd(), file),
        source: await readFile(file, "utf8"),
      }))
    );

    for (const { file, source } of sources) {
      expect(source, `${file} must not import src/renderer`).not.toContain(
        "../../../../renderer/"
      );
      expect(source, `${file} must not import src/main`).not.toContain(
        "../../../../main/"
      );
      expect(source, `${file} must not use renderer alias`).not.toContain(
        'from "@/'
      );
      expect(source, `${file} must not use main alias`).not.toContain(
        'from "@main/'
      );
      expect(source, `${file} must not use preload alias`).not.toContain(
        'from "@preload/'
      );
      expect(
        source,
        `${file} must use @plugins/@shared aliases for cross-package contracts`
      ).not.toMatch(DEEP_HOST_CONTRACT_RE);
      expect(source, `${file} must not use preload globals`).not.toContain(
        "window.pier"
      );
    }
  });

  it("does not reach into renderer registries or stores directly", async () => {
    const files = await collectSourceFiles(WORKTREE_PLUGIN_DIR);
    const source = (
      await Promise.all(files.map((file) => readFile(file, "utf8")))
    ).join("\n");

    expect(source).not.toMatch(HOST_REGISTRY_RE);
    expect(source).toContain("@plugins/api/");
  });

  it("uses command palette aliases and search terms instead of legacy keywords", async () => {
    const files = [
      ...(await collectSourceFiles(WORKTREE_PLUGIN_DIR)),
      join(process.cwd(), "src/plugins/api/renderer.ts"),
    ];
    const offenders = (
      await Promise.all(
        files.map(async (file) => ({
          file: relative(process.cwd(), file),
          source: await readFile(file, "utf8"),
        }))
      )
    )
      .filter(({ source }) => LEGACY_KEYWORDS_RE.test(source))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });
});
