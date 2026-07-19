import type { PierCapability } from "@shared/contracts/permissions.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExternalRendererPluginContext } from "@/lib/plugins/external-plugin-context.ts";
import { createRendererPluginContext } from "@/lib/plugins/host-context.ts";

const TERMINAL_CONTROL_ERROR =
  /plugin capability not granted:.*terminal:control/;

function pluginEntry(
  effectivePermissions: readonly PierCapability[]
): PluginRegistryEntry {
  return {
    effectivePermissions: [...effectivePermissions],
    enabled: true,
    manifest: {
      apiVersion: 1,
      commands: [],
      workbenchWidgets: [],
      settingsPages: [],
      engines: { pier: ">=0.1.0" },
      id: "pier.test-terminals-context",
      name: "Test Terminals Context",
      panels: [],
      permissions: [...effectivePermissions],
      source: { kind: "builtin" },
      terminalStatusItems: [],
      version: "1.0.0",
    },
    runtime: { canToggle: true, enabled: true, kind: "builtin" },
  };
}

function externalPluginEntry(
  effectivePermissions: readonly PierCapability[]
): PluginRegistryEntry {
  const entry = pluginEntry(effectivePermissions);
  return {
    ...entry,
    manifest: {
      ...entry.manifest,
      id: "pier.test-external-terminals",
      source: { kind: "official" },
    },
    runtime: { canToggle: true, enabled: true, kind: "external" },
  };
}

const noopBridge = {
  invoke: vi.fn(() => Promise.resolve({ data: null, ok: true })),
  subscribe: vi.fn(() => () => undefined),
};

describe("plugin terminals context", () => {
  const open = vi.fn(() =>
    Promise.resolve({ panelId: "terminal-9", windowId: "main" })
  );

  beforeEach(() => {
    open.mockClear();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        terminals: { open },
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects builtin open without terminal:control capability", async () => {
    const context = createRendererPluginContext(pluginEntry([]));

    await expect(
      context.terminals.open({ launch: { command: "ssh demo" } })
    ).rejects.toThrow(TERMINAL_CONTROL_ERROR);
    expect(open).not.toHaveBeenCalled();
  });

  it("forwards builtin open to the preload facade when granted", async () => {
    const context = createRendererPluginContext(
      pluginEntry(["terminal:control"])
    );

    await expect(
      context.terminals.open({
        launch: { command: "ssh demo", cwd: "/tmp" },
      })
    ).resolves.toEqual({ panelId: "terminal-9", windowId: "main" });
    expect(open).toHaveBeenCalledWith({
      launch: { command: "ssh demo", cwd: "/tmp" },
    });
  });

  it("defaults builtin open to an empty request", async () => {
    const context = createRendererPluginContext(
      pluginEntry(["terminal:control"])
    );

    await context.terminals.open();

    expect(open).toHaveBeenCalledWith({});
  });

  it("rejects external open without terminal:control capability", async () => {
    const context = createExternalRendererPluginContext(
      externalPluginEntry([]),
      noopBridge,
      () => []
    );

    await expect(
      context.terminals.open({ launch: { command: "ssh demo" } })
    ).rejects.toThrow(TERMINAL_CONTROL_ERROR);
    expect(open).not.toHaveBeenCalled();
  });

  it("forwards external open to the preload facade when granted", async () => {
    const context = createExternalRendererPluginContext(
      externalPluginEntry(["terminal:control"]),
      noopBridge,
      () => []
    );

    await expect(
      context.terminals.open({ launch: { command: "ssh demo" } })
    ).resolves.toEqual({ panelId: "terminal-9", windowId: "main" });
    expect(open).toHaveBeenCalledWith({ launch: { command: "ssh demo" } });
  });
});
