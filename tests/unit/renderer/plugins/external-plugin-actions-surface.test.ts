import type { PierCapability } from "@shared/contracts/permissions.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { useCommandPaletteController } from "@/lib/command-palette/controller.ts";
import { createExternalRendererPluginContext } from "@/lib/plugins/external/context.ts";

function externalEntry(
  commands: readonly { id: string; title: string }[]
): PluginRegistryEntry {
  const permissions: PierCapability[] = [];
  return {
    effectivePermissions: permissions,
    enabled: true,
    manifest: {
      apiVersion: 1,
      commands: commands.map((command) => ({
        ...command,
        permissions: [],
      })),
      canvasActions: [],
      dataProjections: [],
      settingsPages: [],
      engines: { pier: ">=0.1.0" },
      id: "pier.test-actions-surface",
      name: "Test Actions Surface",
      panels: [],
      permissions,
      source: { kind: "official" },
      terminalStatusItems: [],
      version: "1.0.0",
    },
    runtime: { canToggle: true, enabled: true, kind: "external" },
  };
}

const noopBridge = {
  invoke: vi.fn(() => Promise.resolve({ data: null, ok: true })),
  subscribe: vi.fn(() => () => undefined),
};

describe("external plugin action registration", () => {
  afterEach(() => {
    actionRegistry.clearForTests();
    useCommandPaletteController.setState({
      mode: "commands",
      open: false,
      quickPick: null,
      requestId: 0,
      stack: [],
    });
  });

  it("surfaces registered actions on the command palette", () => {
    const context = createExternalRendererPluginContext(
      externalEntry([{ id: "pier.test-actions-surface.go", title: "Go" }]),
      noopBridge,
      () => []
    );
    const dispose = context.actions.register({
      id: "pier.test-actions-surface.go",
      invoke: () => undefined,
      title: "Go",
    });

    const paletteIds = actionRegistry
      .list("command-palette")
      .map((action) => action.id);
    expect(paletteIds).toContain("pier.test-actions-surface.go");

    dispose();
    expect(actionRegistry.get("pier.test-actions-surface.go")).toBeUndefined();
  });

  it("forwards command invocation context to the plugin action", async () => {
    const context = createExternalRendererPluginContext(
      externalEntry([{ id: "pier.test-actions-surface.go", title: "Go" }]),
      noopBridge,
      () => []
    );
    const invoke = vi.fn();
    context.actions.register({
      id: "pier.test-actions-surface.go",
      invoke,
      surfaces: ["command-palette", "create-menu"],
      title: "Go",
    });
    await actionRegistry.get("pier.test-actions-surface.go")?.handler({
      sourcePanelGroupId: "group-1",
      sourcePanelContext: {
        contextId: "ctx",
        projectRootPath: "/tmp/project",
        source: "command",
        updatedAt: 1,
      },
    });
    expect(invoke).toHaveBeenCalledWith({
      sourcePanelContext: {
        contextId: "ctx",
        projectRootPath: "/tmp/project",
        source: "command",
        updatedAt: 1,
      },
      sourcePanelGroupId: "group-1",
    });
  });

  it("can put a panel-open action on the create menu", () => {
    const context = createExternalRendererPluginContext(
      externalEntry([{ id: "pier.test-actions-surface.go", title: "Go" }]),
      noopBridge,
      () => []
    );
    context.actions.register({
      category: "panel",
      id: "pier.test-actions-surface.go",
      invoke: () => undefined,
      surfaces: ["command-palette", "create-menu"],
      title: "Go",
    });

    expect(
      actionRegistry.list("create-menu").map((action) => action.id)
    ).toContain("pier.test-actions-surface.go");
    expect(
      actionRegistry.list("command-palette").map((action) => action.id)
    ).toContain("pier.test-actions-surface.go");
  });

  it("awaits async actions so a later quick pick keeps the command stack", async () => {
    const context = createExternalRendererPluginContext(
      externalEntry([{ id: "pier.test-actions-surface.pick", title: "Pick" }]),
      noopBridge,
      () => []
    );
    context.actions.register({
      id: "pier.test-actions-surface.pick",
      invoke: async () => {
        await Promise.resolve();
        context.commandPalette.openQuickPick({
          items: [{ id: "one", label: "One" }],
          onAccept: vi.fn(),
          title: "Pick one",
        });
      },
      title: "Pick",
    });
    useCommandPaletteController.getState().openPalette();

    await actionRegistry.get("pier.test-actions-surface.pick")?.handler();

    const state = useCommandPaletteController.getState();
    expect(state.mode).toBe("quick-pick");
    expect(state.stack).toHaveLength(1);
    expect(state.stack[0]?.mode).toBe("commands");
  });

  it("propagates external action failures to the command host", async () => {
    const context = createExternalRendererPluginContext(
      externalEntry([{ id: "pier.test-actions-surface.fail", title: "Fail" }]),
      noopBridge,
      () => []
    );
    context.actions.register({
      id: "pier.test-actions-surface.fail",
      invoke: () => Promise.reject(new Error("action failed")),
      title: "Fail",
    });

    await expect(
      actionRegistry.get("pier.test-actions-surface.fail")?.handler()
    ).rejects.toThrow("action failed");
  });

  it("refuses panels.open without panel:open", () => {
    const entry = externalEntry([]);
    entry.manifest.panels = [
      {
        id: "pier.test-actions-surface.board",
        permissions: [],
        title: "Board",
      },
    ];
    const context = createExternalRendererPluginContext(
      entry,
      noopBridge,
      () => []
    );
    expect(() =>
      context.panels.open("pier.test-actions-surface.board")
    ).toThrow(/panel:open/);
  });

  it("rejects undeclared applets", () => {
    const context = createExternalRendererPluginContext(
      externalEntry([]),
      noopBridge,
      () => []
    );
    expect(() =>
      context.applets.render({
        appletId: "missing",
        projectRootPath: "/tmp/project",
      })
    ).toThrow(/undeclared applet/);
  });
});
