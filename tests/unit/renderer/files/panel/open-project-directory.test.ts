import {
  onFilesDiskPathOpened,
  resetFilesDiskPathOpenedForTests,
} from "@plugins/api/files-disk-path-opened.ts";
import {
  onFilesProjectDirectoryOpened,
  resetFilesProjectDirectoryOpenedForTests,
} from "@plugins/api/files-project-directory-opened.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FILES_FILE_PANEL_COMPONENT_ID } from "@/lib/files/open-disk-file-panel.ts";
import {
  createProjectFilesInstanceId,
  openProjectDirectory,
} from "@/lib/files/open-project-directory.ts";
import { openPluginPanelInstance } from "@/lib/plugins/host/panel-instance-open.ts";
import { getPluginPanelRegistrations } from "@/lib/plugins/panel-registry.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";
import { createProjectFilesInstanceId as pluginInstanceId } from "../../../../../src/plugins/builtin/files/renderer/project/open-project.ts";

vi.mock("@/lib/plugins/host/panel-instance-open.ts", () => ({
  groupForPanel: vi.fn(() => ({ id: "g1" })),
  openPluginPanelInstance: vi.fn(() => ({ kind: "opened" })),
}));

vi.mock("@/lib/plugins/panel-registry.ts", () => ({
  getPluginPanelRegistrations: vi.fn(),
}));

const ROOT = "/Users/a/proj";
const CONTEXT = {
  contextId: "ctx:1",
  cwd: "/Users/a/proj/src",
  projectRootPath: ROOT,
  updatedAt: 1,
};

function filesPanel(input: {
  id: string;
  params?: Record<string, unknown>;
  title?: string;
}) {
  return {
    id: input.id,
    params: input.params ?? { context: CONTEXT },
    title: input.title ?? "proj",
    view: { contentComponent: FILES_FILE_PANEL_COMPONENT_ID },
  };
}

describe("openProjectDirectory", () => {
  const openInstance = vi.mocked(openPluginPanelInstance);
  const registrations = vi.mocked(getPluginPanelRegistrations);
  const list = vi.fn();
  const focus = vi.fn();

  beforeEach(() => {
    openInstance.mockClear();
    openInstance.mockReturnValue({ kind: "opened" });
    registrations.mockReturnValue(
      new Map([
        [FILES_FILE_PANEL_COMPONENT_ID, { id: FILES_FILE_PANEL_COMPONENT_ID }],
      ]) as never
    );
    list.mockReset();
    list.mockResolvedValue({ errors: [], panels: [] });
    focus.mockReset();
    focus.mockResolvedValue(undefined);
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: { panels: { focus, list } },
    });
    useWorkspaceStore.getState().setApi({
      activePanel: null,
      groups: [],
      panels: [],
    } as never);
    resetFilesProjectDirectoryOpenedForTests();
    resetFilesDiskPathOpenedForTests();
  });

  afterEach(() => {
    useWorkspaceStore.getState().setApi(null);
    resetFilesProjectDirectoryOpenedForTests();
    resetFilesDiskPathOpenedForTests();
    vi.clearAllMocks();
  });

  it("matches the files plugin instance-id formula", () => {
    expect(createProjectFilesInstanceId(ROOT)).toBe(pluginInstanceId(ROOT));
  });

  it("returns no-anchor when root is empty", async () => {
    await expect(openProjectDirectory({ root: "  " })).resolves.toEqual({
      ok: false,
      reason: "no-anchor",
    });
    expect(openInstance).not.toHaveBeenCalled();
  });

  it("returns invalid-path without opening for parent-relative paths", async () => {
    await expect(
      openProjectDirectory({ path: "../x", root: ROOT })
    ).resolves.toEqual({ ok: false, reason: "invalid-path" });
    expect(openInstance).not.toHaveBeenCalled();
  });

  it("returns files-unregistered when the files panel is missing", async () => {
    registrations.mockReturnValue(new Map() as never);
    await expect(openProjectDirectory({ root: ROOT })).resolves.toEqual({
      ok: false,
      reason: "files-unregistered",
    });
    expect(openInstance).not.toHaveBeenCalled();
  });

  it("creates a tree-only tab with empty params", async () => {
    const events: Array<{ path: string; root: string }> = [];
    const dispose = onFilesProjectDirectoryOpened((event) => {
      events.push({ path: event.path, root: event.root });
    });
    const result = await openProjectDirectory({
      context: CONTEXT,
      root: ROOT,
    });
    expect(result).toEqual({
      ok: true,
      instanceId: createProjectFilesInstanceId(ROOT),
      reused: false,
    });
    expect(openInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        componentId: FILES_FILE_PANEL_COMPONENT_ID,
        context: CONTEXT,
        instanceId: createProjectFilesInstanceId(ROOT),
        params: {},
        title: "proj",
      })
    );
    expect(openInstance.mock.calls[0]?.[0]).not.toHaveProperty(
      "dropUnpinnedInstances"
    );
    expect(events).toEqual([{ path: "", root: ROOT }]);
    dispose();
  });

  it("does not notify the disk-opened bus", async () => {
    const disk = vi.fn();
    const dispose = onFilesDiskPathOpened(disk);
    await openProjectDirectory({ root: ROOT });
    expect(disk).not.toHaveBeenCalled();
    dispose();
  });

  it("does not reuse a disk editor as the project directory tab", async () => {
    useWorkspaceStore.getState().setApi({
      activePanel: null,
      groups: [],
      panels: [
        filesPanel({
          id: "file-editor",
          params: {
            context: CONTEXT,
            source: { kind: "disk", path: "a.ts", root: ROOT },
          },
          title: "a.ts",
        }),
      ],
    } as never);
    const result = await openProjectDirectory({ context: CONTEXT, root: ROOT });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.reused).toBe(false);
      expect(result.instanceId).toContain(":project:");
    }
    expect(openInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceId: createProjectFilesInstanceId(ROOT),
        params: {},
      })
    );
  });

  it("does not reuse an untitled editor as the project directory tab", async () => {
    useWorkspaceStore.getState().setApi({
      activePanel: null,
      groups: [],
      panels: [
        filesPanel({
          id: "untitled-1",
          params: {
            context: CONTEXT,
            source: { kind: "untitled", untitledId: "u1" },
          },
          title: "Untitled",
        }),
      ],
    } as never);
    const result = await openProjectDirectory({ context: CONTEXT, root: ROOT });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.instanceId).toBe(createProjectFilesInstanceId(ROOT));
      expect(result.reused).toBe(false);
    }
  });

  it("reuses a local project-directory tab and clones params", async () => {
    const existingId = createProjectFilesInstanceId(ROOT);
    useWorkspaceStore.getState().setApi({
      activePanel: { id: "other" },
      groups: [{ id: "g1", panels: [{ id: existingId }] }],
      panels: [
        filesPanel({
          id: existingId,
          params: { context: CONTEXT, extra: true },
        }),
      ],
    } as never);
    const result = await openProjectDirectory({ context: CONTEXT, root: ROOT });
    expect(result).toEqual({
      ok: true,
      instanceId: existingId,
      reused: true,
    });
    expect(openInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceId: existingId,
        params: { context: CONTEXT, extra: true },
        targetGroupId: "g1",
      })
    );
  });

  it("no-ops when the project directory is already active and path is empty", async () => {
    const existingId = createProjectFilesInstanceId(ROOT);
    const directory = vi.fn();
    const dispose = onFilesProjectDirectoryOpened(directory);
    useWorkspaceStore.getState().setApi({
      activePanel: { id: existingId },
      groups: [],
      panels: [filesPanel({ id: existingId })],
    } as never);
    await expect(
      openProjectDirectory({ context: CONTEXT, root: ROOT })
    ).resolves.toEqual({
      ok: true,
      instanceId: existingId,
      reused: true,
    });
    expect(openInstance).not.toHaveBeenCalled();
    expect(directory).not.toHaveBeenCalled();
    dispose();
  });

  it("emits the bus without reopening when active and path is nonempty", async () => {
    const existingId = createProjectFilesInstanceId(ROOT);
    const events: string[] = [];
    const dispose = onFilesProjectDirectoryOpened((event) => {
      events.push(event.path);
    });
    useWorkspaceStore.getState().setApi({
      activePanel: { id: existingId },
      groups: [],
      panels: [filesPanel({ id: existingId })],
    } as never);
    await expect(
      openProjectDirectory({
        context: CONTEXT,
        path: "src/a.ts",
        root: ROOT,
      })
    ).resolves.toMatchObject({ ok: true, reused: true });
    expect(openInstance).not.toHaveBeenCalled();
    expect(events).toEqual(["src/a.ts"]);
    dispose();
  });

  it("focuses another window instead of opening locally", async () => {
    const remoteId = createProjectFilesInstanceId(ROOT);
    list
      .mockResolvedValueOnce({
        errors: [],
        panels: [
          {
            component: FILES_FILE_PANEL_COMPONENT_ID,
            id: remoteId,
            kind: "file",
            params: { context: CONTEXT },
            windowId: "win-remote",
          },
        ],
      })
      .mockResolvedValueOnce([
        {
          component: FILES_FILE_PANEL_COMPONENT_ID,
          id: remoteId,
          kind: "file",
          windowId: "win-remote",
        },
      ]);
    const directory = vi.fn();
    const dispose = onFilesProjectDirectoryOpened(directory);
    const result = await openProjectDirectory({ context: CONTEXT, root: ROOT });
    expect(result).toEqual({
      ok: true,
      instanceId: remoteId,
      reused: true,
    });
    expect(focus).toHaveBeenCalledWith(remoteId, { windowId: "win-remote" });
    expect(openInstance).not.toHaveBeenCalled();
    expect(directory).not.toHaveBeenCalled();
    dispose();
  });

  it("does not treat a current-window listing hit as remote", async () => {
    const localId = createProjectFilesInstanceId(ROOT);
    useWorkspaceStore.getState().setApi({
      activePanel: { id: "other" },
      groups: [{ id: "g1", panels: [{ id: localId }] }],
      panels: [filesPanel({ id: localId })],
    } as never);
    list.mockResolvedValue({
      errors: [],
      panels: [
        {
          component: FILES_FILE_PANEL_COMPONENT_ID,
          id: localId,
          kind: "file",
          windowId: "win-local",
        },
      ],
    });
    await openProjectDirectory({ context: CONTEXT, root: ROOT });
    expect(focus).not.toHaveBeenCalled();
    expect(openInstance).toHaveBeenCalledWith(
      expect.objectContaining({ instanceId: localId })
    );
  });
});
