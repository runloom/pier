import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "/unused-in-this-test") },
}));

import type { PluginService } from "@main/services/plugin-service.ts";
import {
  createPluginSettingsService,
  PluginSettingsServiceError,
} from "@main/services/plugin-settings-service.ts";
import { createPluginSettingsStore } from "@main/state/plugin-settings.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";

function gitEntry(enabled = true): PluginRegistryEntry {
  return {
    effectivePermissions: [],
    enabled,
    manifest: {
      apiVersion: 1,
      commands: [],
      configuration: {
        properties: {
          "pier.git.statusItem.showDirtyIndicator": {
            default: true,
            type: "boolean",
          },
          "pier.git.statusItem.mode": {
            default: "auto",
            enum: ["auto", "manual"],
            type: "string",
          },
          "pier.git.statusItem.limit": {
            default: 10,
            maximum: 100,
            minimum: 1,
            type: "number",
          },
        },
      },
      missionControlWidgets: [],
      settingsPages: [],
      engines: { pier: ">=0.1.0" },
      id: "pier.git",
      name: "Git",
      panels: [],
      permissions: [],
      source: { kind: "builtin" },
      terminalStatusItems: [],
      version: "1.0.0",
    },
    runtime: { canToggle: true, enabled, kind: "builtin" },
  };
}

function pluginsWith(entries: PluginRegistryEntry[]): PluginService {
  return {
    inspect: (id) =>
      Promise.resolve(
        entries.find((entry) => entry.manifest.id === id) ?? null
      ),
    list: () => Promise.resolve({ diagnostics: [], entries }),
    setEnabled: () => Promise.reject(new Error("unused in this test")),
  };
}

describe("PluginSettingsService", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pier-plugin-settings-service-"));
  });

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true });
  });

  function makeService(entries = [gitEntry()]) {
    return createPluginSettingsService({
      plugins: pluginsWith(entries),
      store: createPluginSettingsStore({
        filePath: join(tempDir, "plugin-settings.json"),
      }),
    });
  }

  it("set 合法值：resolve 时内存已提交，返回全量新快照并广播 changedKeys", async () => {
    const service = makeService();
    const payloads: unknown[] = [];
    service.onDidChange((payload) => payloads.push(payload));

    const state = await service.set(
      "pier.git.statusItem.showDirtyIndicator",
      false
    );
    expect(state.values["pier.git.statusItem.showDirtyIndicator"]).toBe(false);
    expect(service.getValues()["pier.git.statusItem.showDirtyIndicator"]).toBe(
      false
    );
    expect(payloads).toEqual([
      {
        changedKeys: ["pier.git.statusItem.showDirtyIndicator"],
        values: { "pier.git.statusItem.showDirtyIndicator": false },
      },
    ]);
  });

  it("set 未声明 key → not_found；禁用插件的 key 同样 not_found", async () => {
    await expect(
      makeService().set("pier.git.unknown", true)
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      makeService([gitEntry(false)]).set(
        "pier.git.statusItem.showDirtyIndicator",
        false
      )
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("set 类型/enum/min-max 不合法 → invalid_command", async () => {
    const service = makeService();
    await expect(
      service.set("pier.git.statusItem.showDirtyIndicator", "yes")
    ).rejects.toBeInstanceOf(PluginSettingsServiceError);
    await expect(
      service.set("pier.git.statusItem.mode", "off")
    ).rejects.toMatchObject({ code: "invalid_command" });
    await expect(
      service.set("pier.git.statusItem.limit", 0)
    ).rejects.toMatchObject({ code: "invalid_command" });
  });

  it("set 与当前存储值相等（Object.is）→ 短路：不写 store、不 emit、直接返回当前快照", async () => {
    const store = createPluginSettingsStore({
      filePath: join(tempDir, "plugin-settings.json"),
    });
    const service = createPluginSettingsService({
      plugins: pluginsWith([gitEntry()]),
      store,
    });

    const first = await service.set(
      "pier.git.statusItem.showDirtyIndicator",
      false
    );
    expect(first.values["pier.git.statusItem.showDirtyIndicator"]).toBe(false);

    const payloads: unknown[] = [];
    service.onDidChange((payload) => payloads.push(payload));
    const setValueSpy = vi.spyOn(store, "setValue");

    const second = await service.set(
      "pier.git.statusItem.showDirtyIndicator",
      false
    );

    expect(second).toEqual(first);
    expect(payloads).toHaveLength(0);
    expect(setValueSpy).not.toHaveBeenCalled();
  });

  it("连续两次 set 只触发一次 plugins.list()（enabled-properties 缓存）", async () => {
    let listCalls = 0;
    const entries = [gitEntry()];
    const plugins: PluginService = {
      inspect: () => Promise.reject(new Error("unused in this test")),
      list: () => {
        listCalls += 1;
        return Promise.resolve({ diagnostics: [], entries });
      },
      setEnabled: () => Promise.reject(new Error("unused in this test")),
    };
    const service = createPluginSettingsService({
      plugins,
      store: createPluginSettingsStore({
        filePath: join(tempDir, "plugin-settings.json"),
      }),
    });

    await service.set("pier.git.statusItem.mode", "manual");
    expect(listCalls).toBe(1);

    await service.set("pier.git.statusItem.limit", 5);
    expect(listCalls).toBe(1);
  });

  it("invalidateCache() 后下次 set 重建缓存（registry 变化可见）", async () => {
    let listCalls = 0;
    let entries = [gitEntry()];
    const plugins: PluginService = {
      inspect: () => Promise.reject(new Error("unused in this test")),
      list: () => {
        listCalls += 1;
        return Promise.resolve({ diagnostics: [], entries });
      },
      setEnabled: () => Promise.reject(new Error("unused in this test")),
    };
    const service = createPluginSettingsService({
      plugins,
      store: createPluginSettingsStore({
        filePath: join(tempDir, "plugin-settings.json"),
      }),
    });

    await service.set("pier.git.statusItem.mode", "manual");
    expect(listCalls).toBe(1);

    // registry 变化：git 插件被禁用，key 应变为 not_found。
    entries = [gitEntry(false)];
    service.invalidateCache();

    await expect(
      service.set("pier.git.statusItem.limit", 5)
    ).rejects.toMatchObject({ code: "not_found" });
    expect(listCalls).toBe(2);
  });

  it("reset 删除 key 且仅在 key 存在时广播", async () => {
    const service = makeService();
    const payloads: unknown[] = [];
    await service.set("pier.git.statusItem.mode", "manual");
    service.onDidChange((payload) => payloads.push(payload));

    const state = await service.reset("pier.git.statusItem.mode");
    expect(state.values).toEqual({});
    expect(payloads).toHaveLength(1);

    await service.reset("pier.git.statusItem.mode");
    expect(payloads).toHaveLength(1);
  });
});
