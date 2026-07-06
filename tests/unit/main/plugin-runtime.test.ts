import { createMainPluginHostApi } from "@main/plugins/host-api.ts";
import { MainPluginRuntime } from "@main/plugins/runtime.ts";
import type { PluginSettingsService } from "@main/services/plugin-settings-service.ts";
import type { MainPluginContext } from "@plugins/api/main.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { describe, expect, it, vi } from "vitest";

function entry(id: string, enabled: boolean): PluginRegistryEntry {
  return {
    effectivePermissions: [],
    enabled,
    manifest: {
      apiVersion: 1,
      commands: [],
      dashboardWidgets: [],
      engines: { pier: ">=0.1.0" },
      id,
      name: id,
      panels: [],
      permissions: [],
      source: { kind: "builtin" },
      terminalStatusItems: [],
      version: "1.0.0",
    },
    runtime: {
      canToggle: true,
      enabled,
      kind: "builtin",
    },
  };
}

function stubContext(): MainPluginContext {
  return {
    configuration: {
      get: <T>(_key: string): T => undefined as unknown as T,
      onDidChange: () => () => undefined,
      reset: () => Promise.resolve(),
      set: () => Promise.resolve(),
    },
  };
}

function stubSettings(): PluginSettingsService {
  return {
    getAll: () => Promise.resolve({ values: {}, version: 1 }),
    getValues: () => ({}),
    init: () => Promise.resolve(),
    invalidateCache: () => undefined,
    onDidChange: () => () => undefined,
    reset: () => Promise.resolve({ values: {}, version: 1 }),
    set: () => Promise.resolve({ values: {}, version: 1 }),
  };
}

describe("MainPluginRuntime", () => {
  it("activates enabled builtin modules and disposes disabled modules", () => {
    const dispose = vi.fn();
    const activate = vi.fn(() => dispose);
    const runtime = new MainPluginRuntime(
      [{ activate, id: "sample.plugin" }],
      stubContext
    );

    runtime.refresh([entry("sample.plugin", true)]);
    expect(activate).toHaveBeenCalledTimes(1);

    runtime.refresh([entry("sample.plugin", true)]);
    expect(activate).toHaveBeenCalledTimes(1);

    runtime.refresh([entry("sample.plugin", false)]);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("为每个启用插件按 entry 创建独立 context", () => {
    const seen: string[] = [];
    const runtime = new MainPluginRuntime(
      [
        { activate: () => () => undefined, id: "pier.a" },
        { activate: () => () => undefined, id: "pier.b" },
      ],
      (entry) => {
        seen.push(entry.manifest.id);
        return stubContext();
      }
    );
    runtime.refresh([entry("pier.a", true), entry("pier.b", true)]);
    expect(seen).toEqual(["pier.a", "pier.b"]);
  });

  it("已激活插件的 getEntries 在后续 refresh 后现算最新快照（不冻结首次激活时的 entries）", () => {
    let getEntriesForA: (() => readonly PluginRegistryEntry[]) | undefined;
    const runtime = new MainPluginRuntime(
      [
        { activate: () => () => undefined, id: "pier.a" },
        { activate: () => () => undefined, id: "pier.b" },
      ],
      (entryArg, getEntries) => {
        if (entryArg.manifest.id === "pier.a") {
          getEntriesForA = getEntries;
        }
        return stubContext();
      }
    );

    // 首次 refresh：只有 pier.a 存在，激活并捕获它的 getEntries。
    runtime.refresh([entry("pier.a", true)]);
    expect(getEntriesForA?.()).toEqual([entry("pier.a", true)]);

    // 第二次 refresh：pier.b 加入 registry；pier.a 已激活，不会重新创建 context，
    // 但它捕获的 getEntries() 现算应反映最新快照（含 pier.b）。
    runtime.refresh([entry("pier.a", true), entry("pier.b", true)]);
    expect(getEntriesForA?.()).toEqual([
      entry("pier.a", true),
      entry("pier.b", true),
    ]);
  });
});

describe("createMainPluginHostApi", () => {
  it("refreshes main plugin runtime after enable/disable changes", async () => {
    const runtime = {
      refresh: vi.fn(),
    };
    const plugin = entry("sample.plugin", true);
    const plugins = {
      inspect: vi.fn(async () => plugin),
      list: vi.fn(async () => ({ diagnostics: [], entries: [plugin] })),
      setEnabled: vi.fn(async () => plugin),
    };

    const host = createMainPluginHostApi({
      plugins,
      runtime,
      settings: stubSettings(),
    });

    await host.refresh();
    await host.plugins.setEnabled("sample.plugin", false);

    expect(runtime.refresh).toHaveBeenCalledTimes(2);
    expect(runtime.refresh).toHaveBeenCalledWith([plugin]);
  });

  it("disposes the main plugin runtime through the host api", () => {
    const runtime = {
      dispose: vi.fn(),
      refresh: vi.fn(),
    };
    const plugins = {
      inspect: vi.fn(),
      list: vi.fn(),
      setEnabled: vi.fn(),
    };

    const host = createMainPluginHostApi({
      plugins,
      runtime,
      settings: stubSettings(),
    });

    host.dispose();

    expect(runtime.dispose).toHaveBeenCalledTimes(1);
  });

  it("notifies onRegistryChanged with the latest snapshot after refresh and setEnabled", async () => {
    const runtime = {
      refresh: vi.fn(),
    };
    const plugin = entry("sample.plugin", true);
    const listResult = { diagnostics: [], entries: [plugin] };
    const plugins = {
      inspect: vi.fn(async () => plugin),
      list: vi.fn(async () => listResult),
      setEnabled: vi.fn(async () => plugin),
    };
    const onRegistryChanged = vi.fn();

    const host = createMainPluginHostApi({
      onRegistryChanged,
      plugins,
      runtime,
      settings: stubSettings(),
    });

    await host.refresh();
    expect(onRegistryChanged).toHaveBeenCalledTimes(1);
    expect(onRegistryChanged).toHaveBeenCalledWith(listResult);

    await host.plugins.setEnabled("sample.plugin", false);
    expect(onRegistryChanged).toHaveBeenCalledTimes(2);
  });

  it("先 await settings.init() 再 list plugins，保证 activate 期间同步 get 可用", async () => {
    const runtime = { refresh: vi.fn() };
    const plugin = entry("sample.plugin", true);
    const calls: string[] = [];
    const plugins = {
      inspect: vi.fn(async () => plugin),
      list: vi.fn(() => {
        calls.push("list");
        return Promise.resolve({ diagnostics: [], entries: [plugin] });
      }),
      setEnabled: vi.fn(async () => plugin),
    };
    const settings: PluginSettingsService = {
      ...stubSettings(),
      init: () => {
        calls.push("init");
        return Promise.resolve();
      },
    };

    const host = createMainPluginHostApi({ plugins, runtime, settings });
    await host.refresh();

    expect(calls).toEqual(["init", "list"]);
  });
});
