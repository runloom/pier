import type {
  PluginRegistryEntry,
  PluginRegistryListResult,
} from "@shared/contracts/plugin.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { runtimeMock } = vi.hoisted(() => ({
  runtimeMock: { dispose: vi.fn(), refresh: vi.fn() },
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
      missionControlWidgets: [],
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
    ).toBe("pier.a:builtin:");
    expect(activeBuiltinPluginKey([])).toBe("");
  });

  it("初始拉取后 refresh runtime 一次", async () => {
    installPierMock(async () => listResult(entry("pier.git", true)));
    const { bootstrapBuiltinPlugins } = await import(
      "@/lib/plugins/bootstrap.ts"
    );

    await bootstrapBuiltinPlugins();

    expect(runtimeMock.refresh).toHaveBeenCalledTimes(1);
    const passed = runtimeMock.refresh.mock.calls[0]?.[0] as
      | PluginRegistryEntry[]
      | undefined;
    expect(passed?.map((e) => e.manifest.id)).toEqual(["pier.git"]);
  });

  it("广播运行态集合变化才 refresh runtime, 无实质变化去重", async () => {
    const pier = installPierMock(async () =>
      listResult(entry("pier.git", true))
    );
    const { bootstrapBuiltinPlugins } = await import(
      "@/lib/plugins/bootstrap.ts"
    );
    await bootstrapBuiltinPlugins();
    runtimeMock.refresh.mockClear();

    // 新数组引用、相同运行态集合 → 去重, 不 dispose+reactivate
    pier.emit(listResult(entry("pier.git", true)));
    expect(runtimeMock.refresh).not.toHaveBeenCalled();

    // 运行态集合变化 → refresh
    pier.emit(listResult(entry("pier.git", false)));
    expect(runtimeMock.refresh).toHaveBeenCalledTimes(1);
  });

  it("返回的清理函数注销订阅并 dispose runtime", async () => {
    const pier = installPierMock(async () =>
      listResult(entry("pier.git", true))
    );
    const { bootstrapBuiltinPlugins } = await import(
      "@/lib/plugins/bootstrap.ts"
    );
    const cleanup = await bootstrapBuiltinPlugins();
    runtimeMock.refresh.mockClear();

    cleanup();

    expect(runtimeMock.dispose).toHaveBeenCalledTimes(1);
    pier.emit(listResult(entry("pier.git", false)));
    expect(runtimeMock.refresh).not.toHaveBeenCalled();
  });
});
