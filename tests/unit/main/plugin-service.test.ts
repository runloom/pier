import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectEffectivePermissions,
  createPluginService,
  type PluginServiceError,
} from "@main/services/plugin-service.ts";
import { GIT_PLUGIN_MANIFEST } from "@plugins/builtin/git/manifest.ts";
import { pluginManifestSchema } from "@shared/contracts/plugin.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pier-plugin-service-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

const builtinManifest = {
  apiVersion: 1,
  commands: [
    {
      id: "sample.sayHello",
      permissions: ["workspace:open"],
      title: "Say Hello",
    },
  ],
  description: "Sample builtin plugin",
  engines: { pier: ">=0.1.0" },
  homepage: "https://example.com/pier-plugin",
  id: "sample.builtin",
  name: "Sample Builtin",
  panels: [
    {
      component: "sample.panel",
      id: "sample.panel",
      permissions: ["panel:register"],
      title: "Sample Panel",
    },
  ],
  permissions: ["plugin:read", "panel:register", "command:register"],
  publisher: "Pier",
  repository: "https://example.com/repo.git",
  source: { kind: "builtin" },
  terminalStatusItems: [
    {
      id: "sample.status",
      permissions: ["terminal:read"],
      title: "Sample Status",
    },
  ],
  version: "1.0.0",
};

const emptyState = {
  read: () => Promise.resolve({ plugins: {}, version: 1 as const }),
  setEnabled: (id: string, enabled: boolean) =>
    Promise.resolve({
      plugins: { [id]: { enabled, updatedAt: 1 } },
      version: 1 as const,
    }),
};

describe("pluginManifestSchema", () => {
  it("校验 manifest source、权限、commands、panels 和 terminal status items", () => {
    expect(pluginManifestSchema.parse(builtinManifest)).toMatchObject({
      commands: [{ id: "sample.sayHello" }],
      panels: [{ id: "sample.panel" }],
      permissions: ["plugin:read", "panel:register", "command:register"],
      source: { kind: "builtin" },
      terminalStatusItems: [{ id: "sample.status" }],
    });
  });

  it("支持插件自带 localization 配置和内联 locales", () => {
    expect(
      pluginManifestSchema.parse({
        ...builtinManifest,
        localization: {
          defaultLocale: "en",
          files: { "zh-CN": "locales/zh-CN.json" },
          locales: ["en", "zh-CN"],
        },
        locales: {
          "zh-CN": {
            commands: {
              "sample.sayHello": {
                aliases: ["hello", "ni hao"],
                description: "输出问候语。",
                title: "打招呼",
              },
            },
            description: "示例内置插件",
            messages: {
              "ui.title": "示例",
            },
            name: "示例内置",
            panels: {
              "sample.panel": {
                description: "展示示例内容。",
                title: "示例面板",
              },
            },
            terminalStatusItems: {
              "sample.status": {
                description: "展示示例状态。",
                title: "示例状态",
              },
            },
          },
        },
      })
    ).toMatchObject({
      localization: {
        defaultLocale: "en",
        files: { "zh-CN": "locales/zh-CN.json" },
        locales: ["en", "zh-CN"],
      },
      locales: {
        "zh-CN": {
          commands: {
            "sample.sayHello": {
              aliases: ["hello", "ni hao"],
              title: "打招呼",
            },
          },
          description: "示例内置插件",
          messages: {
            "ui.title": "示例",
          },
          name: "示例内置",
          panels: {
            "sample.panel": { title: "示例面板" },
          },
          terminalStatusItems: {
            "sample.status": { title: "示例状态" },
          },
        },
      },
    });
  });

  it("合并 manifest、命令、面板和终端状态项权限为有效权限", () => {
    expect(
      collectEffectivePermissions(pluginManifestSchema.parse(builtinManifest))
    ).toEqual([
      "workspace:open",
      "terminal:read",
      "plugin:read",
      "command:register",
      "panel:register",
    ]);
  });

  it("Git 插件为变更树和 diff 面板申请 panel 权限", () => {
    expect(collectEffectivePermissions(GIT_PLUGIN_MANIFEST)).toEqual([
      "environment:read",
      "workspace:open",
      "worktree:read",
      "worktree:write",
      "panel:open",
      "command:register",
      "panel:register",
      "git:read",
      "git:write",
      "file:read",
      "ai:invoke",
    ]);
  });

  it("workbench widget 声明的权限并入有效权限", () => {
    const manifest = pluginManifestSchema.parse({
      apiVersion: 1,
      commands: [],
      workbenchWidgets: [
        {
          id: "sample.widget",
          permissions: ["app:read"],
          title: "Sample Widget",
        },
      ],
      engines: { pier: ">=0.1.0" },
      id: "sample.workbench",
      name: "Sample Workbench",
      source: { kind: "builtin" },
      version: "1.0.0",
    });
    expect(collectEffectivePermissions(manifest)).toContain("app:read");
  });

  it("workbench widget 权限与顶层/命令/面板权限去重合并", () => {
    const manifest = pluginManifestSchema.parse({
      apiVersion: 1,
      commands: [
        {
          id: "sample.cmd",
          permissions: ["plugin:read"],
          title: "Cmd",
        },
      ],
      workbenchWidgets: [
        {
          id: "sample.widget",
          permissions: ["plugin:read", "app:read"],
          title: "Widget",
        },
      ],
      engines: { pier: ">=0.1.0" },
      id: "sample.dedup",
      name: "Sample Dedup",
      permissions: ["command:register"],
      source: { kind: "builtin" },
      version: "1.0.0",
    });
    const perms = collectEffectivePermissions(manifest);
    // 去重：plugin:read 只出现一次
    expect(perms.filter((p) => p === "plugin:read")).toHaveLength(1);
    expect(perms).toContain("app:read");
    expect(perms).toContain("command:register");
  });

  it("拒绝无效 manifest", () => {
    expect(() =>
      pluginManifestSchema.parse({
        ...builtinManifest,
        id: "",
        source: { kind: "remote" },
      })
    ).toThrow();
  });

  it("拒绝空的插件国际化文案", () => {
    expect(() =>
      pluginManifestSchema.parse({
        ...builtinManifest,
        locales: {
          "zh-CN": {
            name: "",
          },
        },
      })
    ).toThrow();
  });
});

describe("createPluginService", () => {
  it("发现 builtin 和 local manifest，并支持 list/inspect", async () => {
    const dir = await makeTempDir();
    const localPath = join(dir, "pier-plugin.json");
    await writeFile(
      localPath,
      JSON.stringify({
        ...builtinManifest,
        commands: [
          {
            id: "sample.local.sayHello",
            permissions: ["workspace:open"],
            title: "Say Hello",
          },
        ],
        id: "sample.local",
        name: "Sample Local",
        panels: [
          {
            component: "sample.local.panel",
            id: "sample.local.panel",
            permissions: ["panel:register"],
            title: "Sample Local Panel",
          },
        ],
        permissions: ["plugin:read"],
        source: { kind: "local", url: localPath },
        // terminalStatusItems id 须跨插件唯一，避免与 sample.builtin 的 "sample.status" 冲突。
        terminalStatusItems: [
          {
            id: "sample.local.status",
            permissions: ["terminal:read"],
            title: "Sample Local Status",
          },
        ],
      })
    );
    const service = createPluginService({
      sources: [
        { kind: "builtin", manifest: builtinManifest },
        { kind: "local", path: localPath },
      ],
      state: {
        read: () =>
          Promise.resolve({
            plugins: { "sample.local": { enabled: true, updatedAt: 1 } },
            version: 1,
          }),
        setEnabled: (id, enabled) =>
          Promise.resolve({
            plugins: { [id]: { enabled, updatedAt: 2 } },
            version: 1,
          }),
      },
    });

    await expect(service.list()).resolves.toMatchObject({
      diagnostics: [],
      entries: [
        {
          enabled: false,
          manifest: { source: { kind: "builtin" } },
          runtime: {
            canToggle: true,
            enabled: false,
            kind: "builtin",
          },
        },
        {
          enabled: true,
          manifest: { source: { kind: "local", url: localPath } },
          runtime: {
            canToggle: false,
            enabled: false,
            kind: "manifest-only",
          },
        },
      ],
    });

    await expect(service.inspect("sample.local")).resolves.toMatchObject({
      enabled: true,
      effectivePermissions: expect.arrayContaining(["plugin:read"]),
      manifest: {
        commands: [{ id: "sample.local.sayHello" }],
        id: "sample.local",
        panels: [{ id: "sample.local.panel" }],
      },
      runtime: {
        canToggle: false,
        enabled: false,
        kind: "manifest-only",
      },
    });
  });

  it("读取 local 插件目录内的 locale JSON 并合并到 registry entry", async () => {
    const dir = await makeTempDir();
    const localPath = join(dir, "pier-plugin.json");
    const localePath = join(dir, "locales", "zh-CN.json");
    await mkdir(join(dir, "locales"), { recursive: true });
    await writeFile(
      localPath,
      JSON.stringify({
        ...builtinManifest,
        id: "sample.local",
        localization: {
          defaultLocale: "en",
          files: { "zh-CN": "locales/zh-CN.json" },
          locales: ["en", "zh-CN"],
        },
        locales: {
          "zh-CN": {
            commands: {
              "sample.sayHello": { title: "打招呼" },
            },
          },
        },
        name: "Sample Local",
        source: { kind: "local", url: localPath },
      })
    );
    await writeFile(
      localePath,
      JSON.stringify({
        commands: {
          "sample.sayHello": { aliases: ["ni hao"] },
        },
        description: "本地示例插件",
        name: "本地示例",
      })
    );
    const service = createPluginService({
      sources: [{ kind: "local", path: localPath }],
      state: emptyState,
    });

    await expect(service.inspect("sample.local")).resolves.toMatchObject({
      manifest: {
        id: "sample.local",
        locales: {
          "zh-CN": {
            commands: {
              "sample.sayHello": { aliases: ["ni hao"], title: "打招呼" },
            },
            description: "本地示例插件",
            name: "本地示例",
          },
        },
      },
    });
  });

  it("local 插件 locale JSON 错误不阻断 manifest 发现并返回诊断", async () => {
    const dir = await makeTempDir();
    const localPath = join(dir, "pier-plugin.json");
    const localePath = join(dir, "locales", "zh-CN.json");
    await mkdir(join(dir, "locales"), { recursive: true });
    await writeFile(
      localPath,
      JSON.stringify({
        ...builtinManifest,
        id: "sample.local",
        localization: {
          defaultLocale: "en",
          files: { "zh-CN": "locales/zh-CN.json" },
          locales: ["en", "zh-CN"],
        },
        name: "Sample Local",
        source: { kind: "local", url: localPath },
      })
    );
    await writeFile(localePath, JSON.stringify({ name: "" }));
    const service = createPluginService({
      sources: [{ kind: "local", path: localPath }],
      state: emptyState,
    });

    await expect(service.list()).resolves.toMatchObject({
      diagnostics: [
        {
          code: "invalid_manifest",
          message: "invalid plugin locale",
          source: { kind: "local", path: localePath },
        },
      ],
      entries: [
        {
          manifest: { id: "sample.local", name: "Sample Local" },
          runtime: { kind: "manifest-only" },
        },
      ],
    });
  });

  it("enabled/disabled 状态由 userData state 决定", async () => {
    let enabled = false;
    const service = createPluginService({
      sources: [{ kind: "builtin", manifest: builtinManifest }],
      state: {
        read: () =>
          Promise.resolve({
            plugins: { "sample.builtin": { enabled, updatedAt: 1 } },
            version: 1,
          }),
        setEnabled: (_id, nextEnabled) => {
          enabled = nextEnabled;
          return Promise.resolve({
            plugins: { "sample.builtin": { enabled, updatedAt: 2 } },
            version: 1,
          });
        },
      },
    });

    await expect(service.inspect("sample.builtin")).resolves.toMatchObject({
      enabled: false,
    });
    await expect(
      service.setEnabled("sample.builtin", true)
    ).resolves.toMatchObject({
      enabled: true,
    });
  });

  it("local manifest 仅作为清单预览，不允许记录启停状态", async () => {
    const dir = await makeTempDir();
    const localPath = join(dir, "pier-plugin.json");
    await writeFile(
      localPath,
      JSON.stringify({
        ...builtinManifest,
        id: "sample.local",
        name: "Sample Local",
        source: { kind: "local", url: localPath },
      })
    );
    const setEnabled = vi.fn(emptyState.setEnabled);
    const service = createPluginService({
      sources: [{ kind: "local", path: localPath }],
      state: {
        read: emptyState.read,
        setEnabled,
      },
    });

    await expect(service.inspect("sample.local")).resolves.toMatchObject({
      enabled: false,
      manifest: {
        id: "sample.local",
        source: { kind: "local" },
      },
      runtime: {
        canToggle: false,
        enabled: false,
        kind: "manifest-only",
      },
    });
    await expect(
      service.setEnabled("sample.local", true)
    ).rejects.toMatchObject({
      code: "unsupported",
      message: "plugin source kind cannot be enabled yet: local",
    });
    expect(setEnabled).not.toHaveBeenCalled();
  });

  it("内置插件可声明默认启用，且 userData 禁用状态优先", async () => {
    let enabled = false;
    const service = createPluginService({
      sources: [
        { defaultEnabled: true, kind: "builtin", manifest: builtinManifest },
      ],
      state: {
        read: () =>
          Promise.resolve({
            plugins: enabled
              ? {}
              : { "sample.builtin": { enabled: false, updatedAt: 1 } },
            version: 1,
          }),
        setEnabled: (_id, nextEnabled) => {
          enabled = nextEnabled;
          return Promise.resolve({
            plugins: {
              "sample.builtin": { enabled: nextEnabled, updatedAt: 2 },
            },
            version: 1,
          });
        },
      },
    });

    await expect(service.inspect("sample.builtin")).resolves.toMatchObject({
      enabled: false,
      runtime: {
        enabled: false,
        kind: "builtin",
      },
    });
    await expect(
      service.setEnabled("sample.builtin", true)
    ).resolves.toMatchObject({
      enabled: true,
      runtime: {
        enabled: true,
        kind: "builtin",
      },
    });
  });

  it("内置插件未写 userData 状态时使用默认启用值", async () => {
    const service = createPluginService({
      sources: [
        { defaultEnabled: true, kind: "builtin", manifest: builtinManifest },
      ],
      state: emptyState,
    });

    await expect(service.inspect("sample.builtin")).resolves.toMatchObject({
      enabled: true,
      manifest: { id: "sample.builtin" },
      runtime: { enabled: true, kind: "builtin" },
    });
  });

  it("坏 manifest 不阻断其它插件发现，并返回诊断信息", async () => {
    const dir = await makeTempDir();
    const badPath = join(dir, "bad-plugin.json");
    await writeFile(badPath, JSON.stringify({ ...builtinManifest, id: "" }));
    const service = createPluginService({
      sources: [
        { kind: "builtin", manifest: builtinManifest },
        { kind: "local", path: badPath },
      ],
      state: emptyState,
    });

    await expect(service.list()).resolves.toMatchObject({
      diagnostics: [
        {
          code: "invalid_manifest",
          message: "invalid plugin manifest",
          source: { kind: "local", path: badPath },
        },
      ],
      entries: [{ manifest: { id: "sample.builtin" } }],
    });
  });

  it("git 和 registry source 返回明确 unsupported 诊断", async () => {
    const service = createPluginService({
      sources: [{ kind: "git", url: "https://example.com/plugin.git" }],
      state: emptyState,
    });

    await expect(service.list()).resolves.toMatchObject({
      diagnostics: [
        {
          code: "unsupported",
          message: "plugin source kind is not supported yet: git",
          source: { kind: "git", url: "https://example.com/plugin.git" },
        },
      ],
      entries: [],
    } satisfies {
      diagnostics: Array<Partial<PluginServiceError> & { source: unknown }>;
      entries: unknown[];
    });
  });
});
