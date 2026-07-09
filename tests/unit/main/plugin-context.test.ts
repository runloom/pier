import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "/unused-in-this-test") },
}));

import { createMainPluginContext } from "@main/plugins/plugin-context.ts";
import type { PluginService } from "@main/services/plugin-service.ts";
import { createPluginSettingsService } from "@main/services/plugin-settings-service.ts";
import { createPluginSettingsStore } from "@main/state/plugin-settings.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";

const NOT_OWNED_ERROR = /not owned/;

function gitEntry(): PluginRegistryEntry {
  return {
    effectivePermissions: [],
    enabled: true,
    manifest: {
      apiVersion: 1,
      commands: [],
      configuration: {
        properties: {
          "pier.git.statusItem.showDirtyIndicator": {
            default: true,
            type: "boolean",
          },
        },
      },
      missionControlWidgets: [],
      engines: { pier: ">=0.1.0" },
      id: "pier.git",
      name: "Git",
      panels: [],
      permissions: [],
      source: { kind: "builtin" },
      terminalStatusItems: [],
      version: "1.0.0",
    },
    runtime: { canToggle: true, enabled: true, kind: "builtin" },
  };
}

describe("createMainPluginContext(entry).configuration", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pier-plugin-context-"));
  });

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true });
  });

  async function makeContext() {
    const entry = gitEntry();
    const entries = [entry];
    const plugins: PluginService = {
      inspect: () => Promise.resolve(entry),
      list: () => Promise.resolve({ diagnostics: [], entries }),
      setEnabled: () => Promise.reject(new Error("unused")),
    };
    const settings = createPluginSettingsService({
      plugins,
      store: createPluginSettingsStore({
        filePath: join(tempDir, "plugin-settings.json"),
      }),
    });
    await settings.init();
    return {
      context: createMainPluginContext({
        entry,
        getEntries: () => entries,
        settings,
      }),
    };
  }

  it("get 返回生效值：无用户值走 default，set 后 await 立即读到新值", async () => {
    const { context } = await makeContext();
    expect(
      context.configuration.get<boolean>(
        "pier.git.statusItem.showDirtyIndicator"
      )
    ).toBe(true);
    await context.configuration.set(
      "pier.git.statusItem.showDirtyIndicator",
      false
    );
    expect(
      context.configuration.get<boolean>(
        "pier.git.statusItem.showDirtyIndicator"
      )
    ).toBe(false);
  });

  it("set/reset 越权前缀（含 pier.gitx 伪前缀）直接抛错", async () => {
    const { context } = await makeContext();
    await expect(
      context.configuration.set("pier.other.key", true)
    ).rejects.toThrow(NOT_OWNED_ERROR);
    await expect(
      context.configuration.set("pier.gitx.key", true)
    ).rejects.toThrow(NOT_OWNED_ERROR);
    await expect(context.configuration.reset("pier.other.key")).rejects.toThrow(
      NOT_OWNED_ERROR
    );
  });

  it("getEntries 现算：registry 变化后（新插件加入）context.get 读到新 schema 而非陈旧快照", async () => {
    const entryA = gitEntry();
    let entries: PluginRegistryEntry[] = [entryA];
    const plugins: PluginService = {
      inspect: () => Promise.resolve(entryA),
      list: () => Promise.resolve({ diagnostics: [], entries }),
      setEnabled: () => Promise.reject(new Error("unused")),
    };
    const settings = createPluginSettingsService({
      plugins,
      store: createPluginSettingsStore({
        filePath: join(tempDir, "plugin-settings.json"),
      }),
    });
    await settings.init();

    const context = createMainPluginContext({
      entry: entryA,
      getEntries: () => entries,
      settings,
    });

    // 激活时 pier.b 尚未加入 registry，跨插件 get 应为 undefined。
    expect(context.configuration.get<boolean>("pier.b.flag")).toBeUndefined();

    // registry refresh：新插件 pier.b 声明 default true 的 pier.b.flag 加入。
    const entryB: PluginRegistryEntry = {
      effectivePermissions: [],
      enabled: true,
      manifest: {
        apiVersion: 1,
        commands: [],
        configuration: {
          properties: {
            "pier.b.flag": { default: true, type: "boolean" },
          },
        },
        missionControlWidgets: [],
        engines: { pier: ">=0.1.0" },
        id: "pier.b",
        name: "B",
        panels: [],
        permissions: [],
        source: { kind: "builtin" },
        terminalStatusItems: [],
        version: "1.0.0",
      },
      runtime: { canToggle: true, enabled: true, kind: "builtin" },
    };
    entries = [entryA, entryB];

    // 同一个（未重建的）context 实例，getEntries 现算应看到新 schema。
    expect(context.configuration.get<boolean>("pier.b.flag")).toBe(true);
  });

  it("onDidChange 收到 affectsConfiguration 事件，注销后不再收", async () => {
    const { context } = await makeContext();
    const events: boolean[] = [];
    const dispose = context.configuration.onDidChange((e) => {
      events.push(e.affectsConfiguration("pier.git"));
      events.push(e.affectsConfiguration("pier.gitx"));
    });
    await context.configuration.set(
      "pier.git.statusItem.showDirtyIndicator",
      false
    );
    expect(events).toEqual([true, false]);
    dispose();
    await context.configuration.reset("pier.git.statusItem.showDirtyIndicator");
    expect(events).toEqual([true, false]);
  });
});
