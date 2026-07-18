import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FILES_FILE_PANEL_COMPONENT_ID,
  openFilesDiskPath,
} from "@/lib/files/open-disk-file-panel.ts";
import { openPluginPanelInstance } from "@/lib/plugins/host-panel-instance-open.ts";
import { getPluginPanelRegistrations } from "@/lib/plugins/plugin-panel-registry.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

vi.mock("@/lib/plugins/host-panel-instance-open.ts", () => ({
  openPluginPanelInstance: vi.fn(() => ({ kind: "opened" })),
}));

vi.mock("@/lib/plugins/plugin-panel-registry.ts", () => ({
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
    vi.clearAllMocks();
  });

  it("returns false when files panel is not registered", () => {
    registrations.mockReturnValue(new Map() as never);
    expect(openFilesDiskPath({ path: "src/a.ts", root: "/repo" })).toBe(false);
    expect(openInstance).not.toHaveBeenCalled();
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
});
