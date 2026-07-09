import type { PanelContext } from "@shared/contracts/panel.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createActionFromContribution } from "@/lib/actions/contribution-runtime.ts";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { popupContextMenuAt } from "@/lib/context-menu/use-context-menu.ts";
import { createRendererPluginContext } from "@/lib/plugins/host-context.ts";

const surface = "test/context-menu-action-invocation";
const terminalPanelContext: PanelContext = {
  contextId: "ctx-terminal-2",
  cwd: "/repo",
  gitRoot: "/repo",
  projectRootPath: "/repo",
  updatedAt: 123,
};

const disposers: Array<() => void> = [];

function entryWithCommand(actionId: string): PluginRegistryEntry {
  return {
    effectivePermissions: ["command:register"],
    enabled: true,
    manifest: {
      apiVersion: 1,
      commands: [{ id: actionId, permissions: [], title: "Test" }],
      dashboardWidgets: [],
      engines: { pier: ">=0.1.0" },
      id: "pier.test",
      name: "Test",
      panels: [],
      permissions: ["command:register"],
      source: { kind: "builtin" },
      terminalStatusItems: [],
      version: "1.0.0",
    },
    runtime: { canToggle: true, enabled: true, kind: "builtin" },
  };
}

function registerForTest(
  action: Parameters<typeof actionRegistry.register>[0]
) {
  disposers.push(actionRegistry.register(action));
}

describe("context-menu action invocation", () => {
  beforeEach(() => {
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        menu: {
          popup: vi.fn(async () => ({ actionId: "pier.test.action" })),
        },
      },
    });
  });

  afterEach(() => {
    for (const dispose of disposers.splice(0)) {
      dispose();
    }
    vi.restoreAllMocks();
  });

  it("passes context-menu source panel to the selected action", async () => {
    const handler = vi.fn();
    registerForTest({
      category: "Test",
      handler,
      id: "pier.test.action",
      surfaces: [surface],
      title: () => "Test",
    });

    await popupContextMenuAt(
      surface,
      { x: 10, y: 20 },
      {
        sourcePanelComponent: "terminal",
        sourcePanelContext: terminalPanelContext,
        sourcePanelGroupId: "group-terminal-2",
        sourcePanelId: "terminal:2",
      }
    );

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        sourcePanelComponent: "terminal",
        sourcePanelContext: terminalPanelContext,
        sourcePanelGroupId: "group-terminal-2",
        sourcePanelId: "terminal:2",
        surface,
      })
    );
  });

  it("passes invocation through plugin action adapters", async () => {
    const handler = vi.fn();
    const context = createRendererPluginContext(
      entryWithCommand("pier.test.pluginAction")
    );
    disposers.push(
      context.actions.register({
        category: "Test",
        handler,
        id: "pier.test.pluginAction",
        surfaces: [surface],
        title: () => "Plugin Action",
      })
    );
    vi.mocked(window.pier.menu.popup).mockResolvedValue({
      actionId: "pier.test.pluginAction",
    });

    await popupContextMenuAt(
      surface,
      { x: 10, y: 20 },
      { sourcePanelId: "p1" }
    );

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ sourcePanelId: "p1", surface })
    );
  });

  it("passes invocation through action contributions", async () => {
    const handler = vi.fn();
    const action = createActionFromContribution(
      {
        categoryKey: "terminal",
        handler,
        id: "pier.test.contribution",
        surfaces: [surface],
        titleKey: "test.title",
      },
      {
        getContext: () => ({
          terminal: { activeIsTaskPanel: false, hasActivePanel: true },
          workspace: {
            activeGroupPanelCount: 1,
            groupCount: 1,
            hasActivePanel: true,
            hasApi: true,
            panelCount: 1,
          },
        }),
        resolveAliases: () => [],
        t: () => "Contribution",
      }
    );

    await action.handler({ sourcePanelId: "contribution-source", surface });

    expect(handler).toHaveBeenCalledWith({
      sourcePanelId: "contribution-source",
      surface,
    });
  });

  it("allows non-context-menu callers to invoke actions without invocation", async () => {
    const handler = vi.fn();
    registerForTest({
      category: "Test",
      handler,
      id: "pier.test.noInvocation",
      surfaces: ["command-palette"],
      title: () => "No Invocation",
    });

    await actionRegistry.get("pier.test.noInvocation")?.handler();

    expect(handler).toHaveBeenCalledWith();
  });
});
