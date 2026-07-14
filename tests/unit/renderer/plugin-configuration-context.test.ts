import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRendererPluginContext } from "@/lib/plugins/host-context.ts";
import { usePluginRegistryStore } from "@/stores/plugin-registry.store.ts";
import { usePluginSettingsStore } from "@/stores/plugin-settings.store.ts";

const notOwnedErrorPattern = /not owned/;

function gitEntry(): PluginRegistryEntry {
  return {
    effectivePermissions: [],
    enabled: true,
    manifest: {
      apiVersion: 1,
      commands: [],
      workbenchWidgets: [],
      settingsPages: [],
      configuration: {
        properties: {
          "pier.git.statusItem.showDirtyIndicator": {
            default: true,
            type: "boolean",
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
    runtime: { canToggle: true, enabled: true, kind: "builtin" },
  };
}

describe("RendererPluginContext.configuration", () => {
  const setMock = vi.fn();
  const resetMock = vi.fn();

  beforeEach(() => {
    setMock.mockReset().mockResolvedValue({ values: {}, version: 1 });
    resetMock.mockReset().mockResolvedValue({ values: {}, version: 1 });
    usePluginRegistryStore.setState({
      initialized: true,
      plugins: [gitEntry()],
    });
    usePluginSettingsStore.setState({ initialized: true, values: {} });
    vi.stubGlobal("window", {
      ...window,
      pier: {
        pluginSettings: {
          getAll: vi.fn(),
          onChanged: vi.fn(() => () => undefined),
          reset: resetMock,
          set: setMock,
        },
      },
    });
  });

  it("get 生效值 = 用户值 ?? default", () => {
    const context = createRendererPluginContext(gitEntry());
    expect(
      context.configuration.get<boolean>(
        "pier.git.statusItem.showDirtyIndicator"
      )
    ).toBe(true);
    usePluginSettingsStore.setState({
      initialized: true,
      values: { "pier.git.statusItem.showDirtyIndicator": false },
    });
    expect(
      context.configuration.get<boolean>(
        "pier.git.statusItem.showDirtyIndicator"
      )
    ).toBe(false);
  });

  it("set 走镜像 store IPC，越权前缀抛错", async () => {
    const context = createRendererPluginContext(gitEntry());
    await context.configuration.set(
      "pier.git.statusItem.showDirtyIndicator",
      false
    );
    expect(setMock).toHaveBeenCalledWith(
      "pier.git.statusItem.showDirtyIndicator",
      false
    );
    await expect(
      context.configuration.set("pier.other.key", true)
    ).rejects.toThrow(notOwnedErrorPattern);
    await expect(context.configuration.reset("pier.gitx.key")).rejects.toThrow(
      notOwnedErrorPattern
    );
  });

  it("set/reset IPC 失败时插件侧 await 感知 reject（与 main context 同形）", async () => {
    setMock.mockReset().mockRejectedValue(new Error("ipc boom"));
    resetMock.mockReset().mockRejectedValue(new Error("reset boom"));
    const context = createRendererPluginContext(gitEntry());

    await expect(
      context.configuration.set("pier.git.statusItem.showDirtyIndicator", false)
    ).rejects.toThrow("ipc boom");
    expect(usePluginSettingsStore.getState().error).toBe("ipc boom");

    await expect(
      context.configuration.reset("pier.git.statusItem.showDirtyIndicator")
    ).rejects.toThrow("reset boom");
    expect(usePluginSettingsStore.getState().error).toBe("reset boom");
  });

  it("onDidChange 经 subscribePluginSettingsChanges 派发 affectsConfiguration", () => {
    const context = createRendererPluginContext(gitEntry());
    const hits: boolean[] = [];
    const dispose = context.configuration.onDidChange((e) => {
      hits.push(e.affectsConfiguration("pier.git"));
    });
    usePluginSettingsStore.getState().applySnapshot({
      values: { "pier.git.statusItem.showDirtyIndicator": false },
      version: 1,
    });
    expect(hits).toEqual([true]);
    dispose();
  });
});
