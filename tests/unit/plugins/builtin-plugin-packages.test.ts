import { readdirSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const BUILTIN_PLUGINS_DIR = join(process.cwd(), "src/plugins/builtin");
const PLUGIN_API_RENDERER_FILE = join(
  process.cwd(),
  "src/plugins/api/renderer.ts"
);
const SOURCE_FILE_RE = /\.(ts|tsx)$/;
const HOST_REGISTRY_RE =
  /actionRegistry|terminalStatusItemRegistry|useCommandPaletteController|usePanelDescriptorStore/;
const DEEP_HOST_CONTRACT_RE =
  /\.\.\/\.\.\/\.\.\/api|\.\.\/\.\.\/\.\.\/\.\.\/shared/;
// 三层及以上 ../ 落到 renderer|main|preload 即越出插件包边界;
// 插件内部子目录 (如 git/renderer) 相对引用最多两层, 不会误伤
const HOST_ESCAPE_RE = /(\.\.\/){3,}(renderer|main|preload)\//;
const LEGACY_KEYWORDS_RE = /\bkeywords\s*:/;

// 枚举所有 builtin 插件目录: 新插件落地即自动纳入边界扫描, 无需手工登记
const pluginNames = readdirSync(BUILTIN_PLUGINS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

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

async function readPluginSources(
  plugin: string
): Promise<{ file: string; source: string }[]> {
  const files = await collectSourceFiles(join(BUILTIN_PLUGINS_DIR, plugin));
  return await Promise.all(
    files.map(async (file) => ({
      file: relative(process.cwd(), file),
      source: await readFile(file, "utf8"),
    }))
  );
}

describe("all builtin plugin package boundaries", () => {
  // 空目录意味着扫描落空, describe.each 会静默跳过所有断言; 这里兜底
  it("discovers builtin plugin packages", () => {
    expect(pluginNames).toEqual(expect.arrayContaining(["files", "git"]));
  });

  describe.each(pluginNames)("plugin %s", (plugin) => {
    it("does not import host process implementation modules", async () => {
      const sources = await readPluginSources(plugin);
      expect(sources.length).toBeGreaterThan(0);

      for (const { file, source } of sources) {
        expect(
          source,
          `${file} must not escape into src/renderer|main|preload via relative paths`
        ).not.toMatch(HOST_ESCAPE_RE);
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
      const sources = await readPluginSources(plugin);
      const source = sources.map((entry) => entry.source).join("\n");

      expect(source).not.toMatch(HOST_REGISTRY_RE);
      expect(source).toContain("@plugins/api/");
    });

    it("uses command palette aliases and search terms instead of legacy keywords", async () => {
      const offenders = (await readPluginSources(plugin))
        .filter(({ source }) => LEGACY_KEYWORDS_RE.test(source))
        .map(({ file }) => file);

      expect(offenders).toEqual([]);
    });
  });

  // 插件 API renderer 契约是所有插件的公共入口, 单独把门:
  // 命令面板检索走 aliases/searchTerms, 不回退 legacy keywords 字段
  describe("plugin api renderer contract", () => {
    it("does not reintroduce legacy keywords", async () => {
      const source = await readFile(PLUGIN_API_RENDERER_FILE, "utf8");
      expect(source).not.toMatch(LEGACY_KEYWORDS_RE);
    });
  });
});
