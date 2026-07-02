import { createMainPluginHostApi } from "@main/plugins/host-api.ts";
import { MainPluginRuntime } from "@main/plugins/runtime.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { describe, expect, it, vi } from "vitest";

function entry(id: string, enabled: boolean): PluginRegistryEntry {
  return {
    effectivePermissions: [],
    enabled,
    manifest: {
      apiVersion: 1,
      commands: [],
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

describe("MainPluginRuntime", () => {
  it("activates enabled builtin modules and disposes disabled modules", () => {
    const dispose = vi.fn();
    const activate = vi.fn(() => dispose);
    const runtime = new MainPluginRuntime([{ activate, id: "sample.plugin" }]);

    runtime.refresh([entry("sample.plugin", true)]);
    expect(activate).toHaveBeenCalledTimes(1);

    runtime.refresh([entry("sample.plugin", true)]);
    expect(activate).toHaveBeenCalledTimes(1);

    runtime.refresh([entry("sample.plugin", false)]);
    expect(dispose).toHaveBeenCalledTimes(1);
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

    const host = createMainPluginHostApi({ plugins, runtime });

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

    const host = createMainPluginHostApi({ plugins, runtime });

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
    });

    await host.refresh();
    expect(onRegistryChanged).toHaveBeenCalledTimes(1);
    expect(onRegistryChanged).toHaveBeenCalledWith(listResult);

    await host.plugins.setEnabled("sample.plugin", false);
    expect(onRegistryChanged).toHaveBeenCalledTimes(2);
  });
});
