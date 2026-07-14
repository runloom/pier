import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { BUILTIN_PLUGIN_SOURCES } from "@main/plugins/builtin-catalog.ts";
import { createPluginService } from "@main/services/plugin-service.ts";
import { createDefaultPluginSources } from "@main/services/plugin-sources.ts";
import {
  GIT_PLUGIN_ID,
  GIT_PLUGIN_MANIFEST,
} from "@plugins/builtin/git/manifest.ts";
import { describe, expect, it } from "vitest";

const FILES_PLUGIN_ID = "pier.files";
const FILES_FILE_PANEL_ID = "pier.files.filePanel";

const emptyState = {
  read: () => Promise.resolve({ plugins: {}, version: 1 as const }),
  setEnabled: (id: string, enabled: boolean) =>
    Promise.resolve({
      plugins: { [id]: { enabled, updatedAt: 1 } },
      version: 1 as const,
    }),
};

describe("createDefaultPluginSources", () => {
  it("包含默认启用的内置 worktree 插件", async () => {
    const sources = await createDefaultPluginSources();

    expect(sources[0]).toMatchObject({
      baseDir: expect.stringContaining("src/plugins/builtin/git"),
      defaultEnabled: true,
      kind: "builtin",
      manifest: GIT_PLUGIN_MANIFEST,
    });
    expect(GIT_PLUGIN_MANIFEST.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "pier.worktree.list" }),
        expect.objectContaining({ id: "pier.worktree.create" }),
        expect.objectContaining({ id: "pier.worktree.delete" }),
        expect.objectContaining({ id: "pier.worktree.prune" }),
      ])
    );
    expect(GIT_PLUGIN_MANIFEST).toMatchObject({
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

  it("includes the builtin Files plugin manifest and single file-panel declaration", async () => {
    const sources = await createDefaultPluginSources();
    const filesSource = sources.find(
      (source) =>
        source.kind === "builtin" &&
        "id" in source &&
        source.id === FILES_PLUGIN_ID
    );

    expect(filesSource).toBeDefined();
    if (!filesSource) {
      throw new Error("expected builtin Files plugin source");
    }
    expect(filesSource).toMatchObject({
      defaultEnabled: true,
      id: FILES_PLUGIN_ID,
      kind: "builtin",
      main: { id: FILES_PLUGIN_ID },
      manifest: {
        id: FILES_PLUGIN_ID,
        panels: [
          expect.objectContaining({
            component: FILES_FILE_PANEL_ID,
            id: FILES_FILE_PANEL_ID,
            permissions: expect.arrayContaining(["file:read", "file:write"]),
          }),
        ],
        permissions: expect.arrayContaining([
          "command:register",
          "file:read",
          "panel:register",
          "terminal:read",
        ]),
        source: { kind: "builtin" },
      },
    });
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
        "pier.worktree.create": { title: "Create Worktree" },
        "pier.worktree.delete": { title: "Delete Worktrees..." },
        "pier.worktree.list": { title: "List Worktrees" },
      },
      description: "Built-in git command palette and terminal status support.",
      messages: {
        "ui.title": "Worktrees",
      },
      name: "Git",
    });
  });

  it("通过 main builtin catalog 获取 git 插件包静态嵌入 locale", async () => {
    expect(BUILTIN_PLUGIN_SOURCES[0]).toMatchObject({
      baseDir: expect.stringContaining("src/plugins/builtin/git"),
      id: GIT_PLUGIN_ID,
      manifest: GIT_PLUGIN_MANIFEST,
      locales: {
        en: { name: "Git" },
        "zh-CN": { name: "Git" },
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
              "pier.worktree.create": { title: "Create Worktree" },
              "pier.worktree.delete": { title: "Delete Worktrees..." },
              "pier.worktree.list": { title: "List Worktrees" },
            },
            description:
              "Built-in git command palette and terminal status support.",
            messages: {
              "ui.title": "Worktrees",
            },
            name: "Git",
          },
          "zh-CN": {
            commands: {
              "pier.worktree.create": { title: "创建工作树" },
              "pier.worktree.delete": { title: "删除工作树..." },
              "pier.worktree.list": { title: "工作树列表" },
            },
            description: "提供 Git 命令面板入口和终端状态栏支持。",
            messages: {
              "ui.title": "工作树",
            },
            name: "Git",
          },
        },
      },
    });
  });

  it("不把 managed plugins 内部目录扫描为本地插件", async () => {
    const sources = await createDefaultPluginSources();

    expect(sources).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "local" })])
    );
    expect(sources.every((source) => source.kind === "builtin")).toBe(true);
  });
});
