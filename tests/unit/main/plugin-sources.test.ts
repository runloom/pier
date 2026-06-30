import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUILTIN_PLUGIN_SOURCES } from "@main/plugins/builtin-catalog.ts";
import { createPluginService } from "@main/services/plugin-service.ts";
import { createDefaultPluginSources } from "@main/services/plugin-sources.ts";
import { GIT_PLUGIN_MANIFEST } from "@plugins/builtin/git/manifest.ts";
import { GIT_PLUGIN_ID } from "@shared/contracts/plugin.ts";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];
const emptyState = {
  read: () => Promise.resolve({ plugins: {}, version: 1 as const }),
  setEnabled: (id: string, enabled: boolean) =>
    Promise.resolve({
      plugins: { [id]: { enabled, updatedAt: 1 } },
      version: 1 as const,
    }),
};

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pier-plugin-sources-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

describe("createDefaultPluginSources", () => {
  it("包含默认启用的内置 worktree 插件", async () => {
    const sources = await createDefaultPluginSources({
      readDir: async () => [],
      userDataDir: "/tmp/pier-user-data",
    });

    expect(sources[0]).toMatchObject({
      baseDir: expect.stringContaining("src/plugins/builtin/git"),
      defaultEnabled: true,
      kind: "builtin",
      manifest: GIT_PLUGIN_MANIFEST,
    });
    expect(GIT_PLUGIN_MANIFEST).toMatchObject({
      commands: [
        { id: "pier.worktree.list" },
        { id: "pier.worktree.create" },
        { id: "pier.worktree.delete" },
        { id: "pier.git.changes.open" },
      ],
      id: GIT_PLUGIN_ID,
      localization: {
        files: {
          en: "locales/en.json",
          "zh-CN": "locales/zh-CN.json",
        },
        locales: ["en", "zh-CN"],
      },
      source: { kind: "builtin" },
    });
    expect(GIT_PLUGIN_MANIFEST.locales).toBeUndefined();
  });

  it("内置 worktree 插件包包含 manifest 声明的全部 locale 文件和 main/renderer 入口", async () => {
    const worktreeSource = BUILTIN_PLUGIN_SOURCES[0];
    expect(worktreeSource).toBeDefined();
    if (!worktreeSource) {
      throw new Error("expected builtin worktree plugin source");
    }
    expect(worktreeSource).toMatchObject({
      id: GIT_PLUGIN_ID,
      locales: {
        en: {
          messages: {
            "ui.title": "Worktrees",
          },
        },
        "zh-CN": {
          messages: {
            "ui.title": "工作树",
          },
        },
      },
      main: { id: GIT_PLUGIN_ID },
    });

    await expect(
      access(join(worktreeSource.baseDir, "main", "index.ts"))
    ).resolves.toBeUndefined();
    await expect(
      access(join(worktreeSource.baseDir, "renderer", "index.ts"))
    ).resolves.toBeUndefined();

    const files = GIT_PLUGIN_MANIFEST.localization?.files ?? {};
    await expect(Object.keys(files).sort()).toEqual(["en", "zh-CN"]);
    await Promise.all(
      Object.values(files).map((filePath) =>
        access(join(worktreeSource.baseDir, filePath))
      )
    );

    const englishLocale = JSON.parse(
      await readFile(join(worktreeSource.baseDir, "locales", "en.json"), "utf8")
    );
    expect(englishLocale).toMatchObject({
      commands: {
        "pier.worktree.create": { title: "Worktree: Create" },
        "pier.worktree.delete": { title: "Worktree: Delete..." },
        "pier.worktree.list": { title: "Worktree: List" },
      },
      description:
        "Built-in worktree command palette and terminal status support.",
      messages: {
        "ui.title": "Worktrees",
      },
      name: "Worktree",
    });
  });

  it("通过 main builtin catalog 获取 worktree 插件包静态嵌入 locale", async () => {
    expect(BUILTIN_PLUGIN_SOURCES[0]).toMatchObject({
      baseDir: expect.stringContaining("src/plugins/builtin/git"),
      id: GIT_PLUGIN_ID,
      manifest: GIT_PLUGIN_MANIFEST,
      locales: {
        en: { name: "Worktree" },
        "zh-CN": { name: "工作树" },
      },
    });

    const service = createPluginService({
      readTextFile: () =>
        Promise.reject(
          new Error("builtin locale should be statically embedded")
        ),
      sources: BUILTIN_PLUGIN_SOURCES,
      state: emptyState,
    });

    await expect(service.inspect(GIT_PLUGIN_ID)).resolves.toMatchObject({
      manifest: {
        locales: {
          en: {
            commands: {
              "pier.worktree.create": { title: "Worktree: Create" },
              "pier.worktree.delete": { title: "Worktree: Delete..." },
              "pier.worktree.list": { title: "Worktree: List" },
            },
            description:
              "Built-in worktree command palette and terminal status support.",
            messages: {
              "ui.title": "Worktrees",
            },
            name: "Worktree",
          },
          "zh-CN": {
            commands: {
              "pier.worktree.create": { title: "创建工作树" },
              "pier.worktree.delete": { title: "删除工作树..." },
              "pier.worktree.list": { title: "工作树列表" },
            },
            description: "提供工作树命令面板入口和终端状态栏支持。",
            messages: {
              "ui.title": "工作树",
            },
            name: "工作树",
          },
        },
      },
    });
  });

  it("发现 userData/plugins/<id>/plugin.json 本地插件入口", async () => {
    const userDataDir = await makeTempDir();
    const pluginDir = join(userDataDir, "plugins", "sample.local");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(join(pluginDir, "plugin.json"), "{}");

    await expect(createDefaultPluginSources({ userDataDir })).resolves.toEqual(
      expect.arrayContaining([
        {
          kind: "local",
          path: join(pluginDir, "plugin.json"),
        },
      ])
    );
  });
});
