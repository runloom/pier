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
