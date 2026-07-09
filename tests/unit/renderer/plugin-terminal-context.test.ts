import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { PierCapability } from "@shared/contracts/permissions.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import type { TerminalSelectionTextResult } from "@shared/contracts/terminal.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRendererPluginContext } from "@/lib/plugins/host-context.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

const TERMINAL_READ_ERROR = /plugin capability not granted:.*terminal:read/;
const TYPESCRIPT_SOURCE_FILE_PATTERN = /\.(ts|tsx)$/;

function pluginEntry(
  effectivePermissions: readonly PierCapability[]
): PluginRegistryEntry {
  return {
    effectivePermissions: [...effectivePermissions],
    enabled: true,
    manifest: {
      apiVersion: 1,
      commands: [],
      missionControlWidgets: [],
      engines: { pier: ">=0.1.0" },
      id: "pier.test-terminal-context",
      name: "Test Terminal Context",
      panels: [],
      permissions: [...effectivePermissions],
      source: { kind: "builtin" },
      terminalStatusItems: [],
      version: "1.0.0",
    },
    runtime: { canToggle: true, enabled: true, kind: "builtin" },
  };
}

function dockviewPanel(id: string, component: string) {
  return {
    id,
    title: id,
    view: { contentComponent: component },
  };
}

function setActivePanel(panel: ReturnType<typeof dockviewPanel>): void {
  useWorkspaceStore.getState().setApi({
    activeGroup: { panels: [panel] },
    activePanel: panel,
    groups: [{ id: "group-1", panels: [panel] }],
    panels: [panel],
    totalPanels: 1,
  } as never);
}

function builtinPluginSourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...builtinPluginSourceFiles(path));
      continue;
    }
    if (TYPESCRIPT_SOURCE_FILE_PATTERN.test(entry)) {
      files.push(path);
    }
  }
  return files;
}

describe("plugin terminal context", () => {
  const readSelectionText = vi.fn<
    (panelId: string) => Promise<TerminalSelectionTextResult>
  >(async () => ({ kind: "ok", text: "selected" }));

  beforeEach(() => {
    readSelectionText.mockClear();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        terminal: {
          readSelectionText,
        },
      },
    });
    useWorkspaceStore.getState().setApi(null);
  });

  afterEach(() => {
    useWorkspaceStore.getState().setApi(null);
    vi.restoreAllMocks();
  });

  it("rejects readSelectionText without terminal:read capability", async () => {
    const context = createRendererPluginContext(pluginEntry([]));

    await expect(
      context.terminal.readSelectionText("terminal-1")
    ).rejects.toThrow(TERMINAL_READ_ERROR);
    expect(readSelectionText).not.toHaveBeenCalled();
  });

  it("uses the current active terminal panel when panelId is omitted", async () => {
    setActivePanel(dockviewPanel("terminal-1", "terminal"));
    const context = createRendererPluginContext(pluginEntry(["terminal:read"]));

    await expect(context.terminal.readSelectionText()).resolves.toEqual({
      kind: "ok",
      text: "selected",
    });

    expect(context.terminal.activePanelId()).toBe("terminal-1");
    expect(readSelectionText).toHaveBeenCalledWith("terminal-1");
  });

  it("returns empty when panelId is omitted and the active panel is not a terminal", async () => {
    setActivePanel(dockviewPanel("welcome-1", "welcome"));
    const context = createRendererPluginContext(pluginEntry(["terminal:read"]));

    await expect(context.terminal.readSelectionText()).resolves.toEqual({
      kind: "empty",
    });

    expect(context.terminal.activePanelId()).toBeNull();
    expect(readSelectionText).not.toHaveBeenCalled();
  });

  it("uses an explicit panelId when provided", async () => {
    setActivePanel(dockviewPanel("terminal-active", "terminal"));
    const context = createRendererPluginContext(pluginEntry(["terminal:read"]));

    await context.terminal.readSelectionText("terminal-source");

    expect(readSelectionText).toHaveBeenCalledWith("terminal-source");
  });

  it("keeps builtin plugins behind the context.terminal facade for terminal selection reads", () => {
    const builtinRoot = join(process.cwd(), "src/plugins/builtin");
    const offenders = builtinPluginSourceFiles(builtinRoot).filter((path) =>
      readFileSync(path, "utf8").includes(
        "window.pier.terminal.readSelectionText"
      )
    );

    expect(offenders).toEqual([]);
  });
});
