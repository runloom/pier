import type {
  PluginRegistryEntry,
  PluginRegistryListResult,
} from "@shared/contracts/plugin.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function entry(id: string, enabled: boolean): PluginRegistryEntry {
  return {
    effectivePermissions: [],
    enabled,
    manifest: {
      apiVersion: 1,
      commands: [],
      missionControlWidgets: [],
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

function listResult(
  ...entries: PluginRegistryEntry[]
): PluginRegistryListResult {
  return { diagnostics: [], entries };
}

type BroadcastListener = (snapshot: PluginRegistryListResult) => void;

function installPierMock(list: () => Promise<PluginRegistryListResult>) {
  const listeners = new Set<BroadcastListener>();
  const listMock = vi.fn(list);
  const onChangedMock = vi.fn((cb: BroadcastListener) => {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  });
  Object.defineProperty(window, "pier", {
    configurable: true,
    value: {
      plugins: {
        list: listMock,
        onChanged: onChangedMock,
      },
    },
  });
  return {
    emit(snapshot: PluginRegistryListResult) {
      for (const listener of listeners) {
        listener(snapshot);
      }
    },
    listeners,
    listMock,
    onChangedMock,
  };
}

describe("plugin-registry.store", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refresh() 全量拉取并置 initialized", async () => {
    installPierMock(async () => listResult(entry("pier.git", true)));
    const { usePluginRegistryStore } = await import(
      "@/stores/plugin-registry.store.ts"
    );

    expect(usePluginRegistryStore.getState().initialized).toBe(false);
    await usePluginRegistryStore.getState().refresh();

    const state = usePluginRegistryStore.getState();
    expect(state.initialized).toBe(true);
    expect(state.plugins.map((p) => p.manifest.id)).toEqual(["pier.git"]);
    expect(state.diagnostics).toEqual([]);
    expect(state.error).toBeNull();
  });

  it("refresh() 失败时记录 error 且仍置 initialized, plugins 保持原值", async () => {
    installPierMock(() => {
      throw new Error("ipc down");
    });
    const { usePluginRegistryStore } = await import(
      "@/stores/plugin-registry.store.ts"
    );

    await usePluginRegistryStore.getState().refresh();

    const state = usePluginRegistryStore.getState();
    expect(state.error).toBe("ipc down");
    expect(state.initialized).toBe(true);
    expect(state.plugins).toEqual([]);
  });

  it("initPluginRegistry() 先订阅广播再拉取, 广播快照直接进 store", async () => {
    const pier = installPierMock(async () =>
      listResult(entry("pier.git", true))
    );
    const { initPluginRegistry, usePluginRegistryStore } = await import(
      "@/stores/plugin-registry.store.ts"
    );

    const unsubscribe = await initPluginRegistry();

    const onChangedOrder =
      pier.onChangedMock.mock.invocationCallOrder[0] ??
      Number.POSITIVE_INFINITY;
    const listOrder = pier.listMock.mock.invocationCallOrder[0] ?? 0;
    expect(onChangedOrder).toBeLessThan(listOrder);
    expect(pier.listeners.size).toBe(1);
    expect(usePluginRegistryStore.getState().plugins).toHaveLength(1);

    pier.emit(listResult(entry("pier.git", false)));
    expect(usePluginRegistryStore.getState().plugins[0]?.runtime.enabled).toBe(
      false
    );

    unsubscribe();
    expect(pier.listeners.size).toBe(0);
  });
});
