import type {
  PluginRegistryEntry,
  PluginRegistryListResult,
} from "@shared/contracts/plugin.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { runtimeMock } = vi.hoisted(() => ({
  runtimeMock: {
    dispose: vi.fn(async () => undefined),
    refresh: vi.fn(
      async (_entries: readonly PluginRegistryEntry[]) => undefined
    ),
    startExternalActivations: vi.fn(),
  },
}));

vi.mock("@/lib/plugins/runtime.ts", () => ({
  rendererPluginRuntime: runtimeMock,
}));

function entry(id: string, enabled: boolean): PluginRegistryEntry {
  return {
    effectivePermissions: [],
    enabled,
    manifest: {
      apiVersion: 1,
      commands: [],
      workbenchWidgets: [],
      settingsPages: [],
      engines: { pier: ">=0.1.0" },
      id,
      name: id,
      panels: [],
      permissions: [],
      source: { kind: "builtin" },
      terminalStatusItems: [],
      version: "1.0.0",
    },
    runtime: { canToggle: true, enabled, kind: "builtin" },
  };
}

function externalEntry(
  id: string,
  sourceRevision: string
): PluginRegistryEntry {
  return {
    ...entry(id, true),
    manifest: {
      ...entry(id, true).manifest,
      source: { kind: "official" },
    },
    runtime: {
      canToggle: true,
      enabled: true,
      kind: "external",
      rendererEntryUrl: `pier-plugin://${id}/1.0.0/dist/renderer.js`,
      sourceRevision,
    },
  };
}

function listResult(
  ...entries: PluginRegistryEntry[]
): PluginRegistryListResult {
  return { diagnostics: [], entries };
}

type BroadcastListener = (snapshot: PluginRegistryListResult) => void;

function installPierMock(list: () => Promise<PluginRegistryListResult>) {
  const listeners = new Set<BroadcastListener>();
  Object.defineProperty(window, "pier", {
    configurable: true,
    value: {
      plugins: {
        list: vi.fn(list),
        onChanged: vi.fn((cb: BroadcastListener) => {
          listeners.add(cb);
          return () => {
            listeners.delete(cb);
          };
        }),
      },
    },
  });
  return {
    emit(snapshot: PluginRegistryListResult) {
      for (const listener of listeners) {
        listener(snapshot);
      }
    },
  };
}

describe("bootstrapBuiltinPlugins (store 驱动)", () => {
  beforeEach(() => {
    vi.resetModules();
    runtimeMock.dispose.mockClear();
    runtimeMock.refresh.mockClear();
    runtimeMock.startExternalActivations.mockClear();
  });

  it("activeBuiltinPluginKey 只统计运行态 builtin 插件", async () => {
    const { activeBuiltinPluginKey } = await import(
      "@/lib/plugins/bootstrap.ts"
    );
    const disabled = entry("pier.b", false);
    const manifestOnly: PluginRegistryEntry = {
      ...entry("pier.c", true),
      runtime: { canToggle: false, enabled: false, kind: "manifest-only" },
    };
    expect(
      activeBuiltinPluginKey([entry("pier.a", true), disabled, manifestOnly])
    ).toBe("pier.a:1.0.0:builtin::");
    expect(activeBuiltinPluginKey([])).toBe("");
  });

  it("activeBuiltinPluginKey includes external sourceRevision", async () => {
    const { activeBuiltinPluginKey } = await import(
      "@/lib/plugins/bootstrap.ts"
    );

    expect(
      activeBuiltinPluginKey([externalEntry("pier.codex", "rev-a")])
    ).not.toBe(activeBuiltinPluginKey([externalEntry("pier.codex", "rev-b")]));
  });

  it("activeBuiltinPluginKey includes the manifest version", async () => {
    const { activeBuiltinPluginKey } = await import(
      "@/lib/plugins/bootstrap.ts"
    );
    const current = externalEntry("pier.codex", "rev-a");
    const updated: PluginRegistryEntry = {
      ...current,
      manifest: { ...current.manifest, version: "2.0.0" },
    };

    expect(activeBuiltinPluginKey([updated])).not.toBe(
      activeBuiltinPluginKey([current])
    );
  });

  it("初始拉取只等待核心刷新，外部阶段由显式句柄启动", async () => {
    installPierMock(async () => listResult(entry("pier.git", true)));
    const { bootstrapBuiltinPlugins } = await import(
      "@/lib/plugins/bootstrap.ts"
    );

    const handle = await bootstrapBuiltinPlugins();

    expect(runtimeMock.refresh).toHaveBeenCalledTimes(1);
    const passed = runtimeMock.refresh.mock.calls[0]?.[0] as
      | PluginRegistryEntry[]
      | undefined;
    expect(passed?.map((e) => e.manifest.id)).toEqual(["pier.git"]);
    expect(runtimeMock.refresh).toHaveBeenCalledWith(expect.any(Array), {
      startExternal: false,
    });
    expect(runtimeMock.startExternalActivations).not.toHaveBeenCalled();

    handle.startExternal();
    handle.startExternal();

    expect(runtimeMock.startExternalActivations).toHaveBeenCalledOnce();
  });

  it("广播运行态集合变化才 refresh runtime, 无实质变化去重", async () => {
    const pier = installPierMock(async () =>
      listResult(entry("pier.git", true))
    );
    const { bootstrapBuiltinPlugins } = await import(
      "@/lib/plugins/bootstrap.ts"
    );
    const handle = await bootstrapBuiltinPlugins();
    runtimeMock.refresh.mockClear();

    // 新数组引用、相同运行态集合 → 去重, 不 dispose+reactivate
    pier.emit(listResult(entry("pier.git", true)));
    expect(runtimeMock.refresh).not.toHaveBeenCalled();

    // 运行态集合变化 → refresh
    pier.emit(listResult(entry("pier.git", false)));
    expect(runtimeMock.refresh).toHaveBeenCalledTimes(1);
    expect(runtimeMock.refresh).toHaveBeenLastCalledWith(expect.any(Array), {
      startExternal: false,
    });

    handle.startExternal();
    pier.emit(listResult(entry("pier.git", true)));
    expect(runtimeMock.refresh).toHaveBeenLastCalledWith(expect.any(Array), {
      startExternal: true,
    });
  });

  it("does not let an older initial list overwrite a newer broadcast", async () => {
    const pending = Promise.withResolvers<PluginRegistryListResult>();
    const pier = installPierMock(async () => await pending.promise);
    const { bootstrapBuiltinPlugins } = await import(
      "@/lib/plugins/bootstrap.ts"
    );
    const bootstrapping = bootstrapBuiltinPlugins();
    await Promise.resolve();

    pier.emit(listResult(externalEntry("pier.codex", "rev-new")));
    pending.resolve(listResult(externalEntry("pier.codex", "rev-stale")));
    const handle = await bootstrapping;

    const lastEntries = runtimeMock.refresh.mock.lastCall?.[0] as
      | readonly PluginRegistryEntry[]
      | undefined;
    expect(lastEntries?.[0]?.runtime.sourceRevision).toBe("rev-new");
    await handle.dispose();
  });

  it("返回的清理函数注销订阅并 dispose runtime", async () => {
    const pier = installPierMock(async () =>
      listResult(entry("pier.git", true))
    );
    const { bootstrapBuiltinPlugins } = await import(
      "@/lib/plugins/bootstrap.ts"
    );
    const handle = await bootstrapBuiltinPlugins();
    runtimeMock.refresh.mockClear();

    await handle.dispose();

    expect(runtimeMock.dispose).toHaveBeenCalledTimes(1);
    pier.emit(listResult(entry("pier.git", false)));
    expect(runtimeMock.refresh).not.toHaveBeenCalled();
  });

  it("初始化订阅失败时清理 store 订阅和 runtime", async () => {
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        plugins: {
          list: vi.fn(async () => listResult()),
          onChanged: vi.fn(() => {
            throw new Error("broadcast subscription failed");
          }),
        },
      },
    });
    const { bootstrapBuiltinPlugins } = await import(
      "@/lib/plugins/bootstrap.ts"
    );

    await expect(bootstrapBuiltinPlugins()).rejects.toThrow(
      "broadcast subscription failed"
    );
    expect(runtimeMock.dispose).toHaveBeenCalledOnce();
  });
});
