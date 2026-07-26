import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerPanelActions } from "@/lib/actions/panel-actions.ts";
import {
  directoryPathFromContext,
  resolvePanelCopyPath,
} from "@/lib/actions/panel-copy-path.ts";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { buildMenuEntries } from "@/lib/context-menu/build-entries.ts";
import { usePanelDescriptorStore } from "@/stores/panel-descriptor.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

function collectActionIds(
  entries: ReturnType<typeof buildMenuEntries>
): string[] {
  const ids: string[] = [];
  for (const entry of entries) {
    if (entry.type === "action") {
      ids.push(entry.id);
    }
  }
  return ids;
}

function makeContext(cwd: string) {
  return {
    contextId: `ctx:${cwd}`,
    cwd,
    gitRoot: cwd,
    openedPath: cwd,
    projectRootPath: cwd,
    source: "panel" as const,
    updatedAt: 1,
    worktreeKey: cwd,
    worktreeRoot: cwd,
  };
}

describe("panel copy path (tab menu)", () => {
  let disposeActions: (() => void) | undefined;
  const writeText = vi.fn(async (_text: string) => undefined);

  beforeEach(() => {
    actionRegistry.clearForTests();
    disposeActions = registerPanelActions();
    writeText.mockClear();
    usePanelDescriptorStore.setState({ activeId: null, descriptors: {} });
    useWorkspaceStore.getState().setApi(null);
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        clipboard: { writeText },
      },
    });
  });

  afterEach(() => {
    disposeActions?.();
    actionRegistry.clearForTests();
    useWorkspaceStore.getState().setApi(null);
    usePanelDescriptorStore.setState({ activeId: null, descriptors: {} });
    vi.restoreAllMocks();
  });

  it("prefers files disk absolute path over panel directory context", () => {
    useWorkspaceStore.getState().setApi({
      panels: [
        {
          id: "file-1",
          params: {
            context: makeContext("/repo"),
            source: { kind: "disk", path: "src/a.ts", root: "/repo" },
          },
          view: { contentComponent: "pier.files.filePanel" },
        },
      ],
    } as never);
    usePanelDescriptorStore.getState().upsert("file-1", {
      context: makeContext("/repo"),
      display: { short: "a.ts" },
    });

    expect(
      resolvePanelCopyPath({
        sourcePanelId: "file-1",
        surface: "dockview-tab",
      })
    ).toBe("/repo/src/a.ts");
  });

  it("uses held directory path for non-file panels", () => {
    useWorkspaceStore.getState().setApi({
      panels: [
        {
          id: "terminal-1",
          params: { context: makeContext("/repo/packages/ui") },
          view: { contentComponent: "terminal" },
        },
      ],
    } as never);
    usePanelDescriptorStore.getState().upsert("terminal-1", {
      context: makeContext("/repo/packages/ui"),
      display: { short: "ui" },
    });

    expect(
      resolvePanelCopyPath({
        sourcePanelId: "terminal-1",
        surface: "dockview-tab",
      })
    ).toBe("/repo/packages/ui");
  });

  it("returns undefined for global pathless panels", () => {
    useWorkspaceStore.getState().setApi({
      panels: [
        {
          id: "workbench-1",
          params: { widgets: [] },
          view: { contentComponent: "workbench" },
        },
      ],
    } as never);

    expect(
      resolvePanelCopyPath({
        sourcePanelId: "workbench-1",
        surface: "dockview-tab",
      })
    ).toBeUndefined();
  });

  it("hides the tab menu item when there is no path", () => {
    useWorkspaceStore.getState().setApi({
      activePanel: {
        id: "workbench-1",
        view: { contentComponent: "workbench" },
      },
      panels: [
        {
          id: "workbench-1",
          params: {},
          view: { contentComponent: "workbench" },
        },
      ],
    } as never);

    expect(
      collectActionIds(
        buildMenuEntries("dockview-tab", {
          sourcePanelId: "workbench-1",
          surface: "dockview-tab",
        })
      )
    ).not.toContain("pier.panel.copyPath");
  });

  it("shows the tab menu item when a path is held", () => {
    useWorkspaceStore.getState().setApi({
      activePanel: {
        id: "terminal-1",
        view: { contentComponent: "terminal" },
      },
      panels: [
        {
          id: "terminal-1",
          params: {},
          view: { contentComponent: "terminal" },
        },
      ],
    } as never);
    usePanelDescriptorStore.getState().upsert("terminal-1", {
      context: makeContext("/repo"),
      display: { short: "repo" },
    });

    expect(
      collectActionIds(
        buildMenuEntries("dockview-tab", {
          sourcePanelContext: makeContext("/repo"),
          sourcePanelId: "terminal-1",
          surface: "dockview-tab",
        })
      )
    ).toContain("pier.panel.copyPath");
  });

  it("copies the resolved path to the clipboard", async () => {
    useWorkspaceStore.getState().setApi({
      panels: [
        {
          id: "terminal-1",
          params: {},
          view: { contentComponent: "terminal" },
        },
      ],
    } as never);
    const action = actionRegistry.get("pier.panel.copyPath");
    expect(action).toBeDefined();
    await action?.handler({
      sourcePanelContext: makeContext("/repo/app"),
      sourcePanelId: "terminal-1",
      surface: "dockview-tab",
    });
    expect(writeText).toHaveBeenCalledWith("/repo/app");
  });

  it("directoryPathFromContext prefers cwd", () => {
    expect(
      directoryPathFromContext({
        contextId: "c",
        cwd: "/repo/packages/a",
        gitRoot: "/repo",
        projectRootPath: "/repo",
        source: "panel",
        updatedAt: 1,
      })
    ).toBe("/repo/packages/a");
  });
});
