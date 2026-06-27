import { createMainPluginHostApi } from "@main/plugins/host-api.ts";
import { MainPluginRuntime } from "@main/plugins/runtime.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { describe, expect, it, vi } from "vitest";

function entry(id: string, enabled: boolean): PluginRegistryEntry {
  return {
    commands: [],
    enabled,
    id,
    manifest: {
      apiVersion: 1,
      commands: [],
      engines: { pier: ">=0.1.0" },
      id,
      name: id,
      panels: [],
      permissions: [],
      source: { kind: "builtin" },
      version: "1.0.0",
    },
    panels: [],
    permissions: [],
    source: { kind: "builtin" },
    version: "1.0.0",
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
});
