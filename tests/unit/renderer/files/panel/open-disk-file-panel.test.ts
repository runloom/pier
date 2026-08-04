import {
  onFilesDiskPathOpened,
  resetFilesDiskPathOpenedForTests,
} from "@plugins/api/files-disk-path-opened.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FILES_FILE_PANEL_COMPONENT_ID,
  openFilesDiskPath,
} from "@/lib/files/open-disk-file-panel.ts";
import { openPluginPanelInstance } from "@/lib/plugins/host/panel-instance-open.ts";
import { getPluginPanelRegistrations } from "@/lib/plugins/panel-registry.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

vi.mock("@/lib/plugins/host/panel-instance-open.ts", () => ({
  openPluginPanelInstance: vi.fn(() => ({ kind: "opened" })),
}));

vi.mock("@/lib/plugins/panel-registry.ts", () => ({
  getPluginPanelRegistrations: vi.fn(),
}));

describe("openFilesDiskPath", () => {
  const openInstance = vi.mocked(openPluginPanelInstance);
  const registrations = vi.mocked(getPluginPanelRegistrations);

  beforeEach(() => {
    openInstance.mockClear();
    openInstance.mockReturnValue({ kind: "opened" });
    registrations.mockReturnValue(
      new Map([
        [FILES_FILE_PANEL_COMPONENT_ID, { id: FILES_FILE_PANEL_COMPONENT_ID }],
      ]) as never
    );
    useWorkspaceStore.getState().setApi({
      panels: [],
    } as never);
  });

  afterEach(() => {
    useWorkspaceStore.getState().setApi(null);
    resetFilesDiskPathOpenedForTests();
    vi.clearAllMocks();
  });

  it("returns false when files panel is not registered", () => {
    registrations.mockReturnValue(new Map() as never);
    expect(openFilesDiskPath({ path: "src/a.ts", root: "/repo" })).toBe(false);
    expect(openInstance).not.toHaveBeenCalled();
  });

  it("forwards line to the disk-path-opened bus", () => {
    resetFilesDiskPathOpenedForTests();
    const events: Array<{ line?: number; path: string }> = [];
    const dispose = onFilesDiskPathOpened((event) => {
      events.push({
        path: event.path,
        ...(event.line === undefined ? {} : { line: event.line }),
      });
    });
    expect(
      openFilesDiskPath({
        line: 18,
        path: "src/a.ts",
        root: "/repo",
      })
    ).toBe(true);
    expect(events).toEqual([{ line: 18, path: "src/a.ts" }]);
    dispose();
  });

  it("opens a pinned disk file panel when files is available", () => {
    expect(
      openFilesDiskPath({
        context: {
          contextId: "ctx",
          projectRootPath: "/repo",
          updatedAt: 1,
        },
        path: "src/a.ts",
        root: "/repo",
      })
    ).toBe(true);
    expect(openInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        componentId: FILES_FILE_PANEL_COMPONENT_ID,
        dropUnpinnedInstances: true,
        params: {
          pinned: true,
          source: { kind: "disk", path: "src/a.ts", root: "/repo" },
        },
        title: "a.ts",
      })
    );
  });

  it("notifies listeners after a successful open (Git open → tree reveal)", async () => {
    const { onFilesDiskPathOpened } = await import(
      "@/lib/files/open-disk-file-panel.ts"
    );
    const listener = vi.fn();
    const dispose = onFilesDiskPathOpened(listener);
    expect(
      openFilesDiskPath({
        path: "scripts/e2e-runner/setup-mac.sh",
        root: "/repo",
      })
    ).toBe(true);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "scripts/e2e-runner/setup-mac.sh",
        root: "/repo",
      })
    );
    dispose();
  });

  it("reuses an existing same-source files panel instance", () => {
    useWorkspaceStore.getState().setApi({
      panels: [
        {
          id: "existing-file",
          params: {
            pinned: false,
            source: { kind: "disk", path: "src/a.ts", root: "/repo" },
          },
          view: { contentComponent: FILES_FILE_PANEL_COMPONENT_ID },
        },
      ],
    } as never);

    expect(openFilesDiskPath({ path: "src/a.ts", root: "/repo" })).toBe(true);
    expect(openInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        dropUnpinnedInstances: false,
        instanceId: "existing-file",
        params: {
          pinned: false,
          source: { kind: "disk", path: "src/a.ts", root: "/repo" },
        },
      })
    );
  });

  it("refreshes panel context when reusing an existing instance", () => {
    useWorkspaceStore.getState().setApi({
      panels: [
        {
          id: "existing-file",
          params: {
            pinned: true,
            source: { kind: "disk", path: "src/a.ts", root: "/repo" },
          },
          view: { contentComponent: FILES_FILE_PANEL_COMPONENT_ID },
        },
      ],
    } as never);

    const context = {
      contextId: "ctx-worktree",
      gitRoot: "/repo",
      projectRootPath: "/repo",
      updatedAt: 1,
    };
    expect(
      openFilesDiskPath({
        context,
        path: "src/a.ts",
        root: "/repo",
      })
    ).toBe(true);
    expect(openInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        context,
        instanceId: "existing-file",
      })
    );
  });

  it("rejects absolute or parent-relative paths", () => {
    expect(openFilesDiskPath({ path: "/abs/a.ts", root: "/repo" })).toBe(false);
    expect(openFilesDiskPath({ path: "../escape.ts", root: "/repo" })).toBe(
      false
    );
    expect(openInstance).not.toHaveBeenCalled();
  });
});
