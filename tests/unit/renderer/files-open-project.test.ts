import type {
  PluginPanelGlobalInstanceSnapshot,
  PluginPanelInstanceSnapshot,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FILES_FILE_PANEL_ID } from "../../../src/plugins/builtin/files/manifest.ts";
import * as prefs from "../../../src/plugins/builtin/files/renderer/file-tree-preferences.ts";
import {
  createProjectFilesInstanceId,
  openProjectFiles,
} from "../../../src/plugins/builtin/files/renderer/files-open-project.ts";
import * as treeRegistry from "../../../src/plugins/builtin/files/renderer/files-tree-registry.ts";

const baseContext: PanelContext = {
  contextId: "ctx:1",
  projectRootPath: "/Users/a/proj",
  updatedAt: 1,
  cwd: "/Users/a/proj/src",
};

function makePlugin(overrides?: {
  activeInstanceId?: string | null;
  focusInstance?: RendererPluginContext["panels"]["focusInstance"];
  listInstances?: PluginPanelInstanceSnapshot[];
  listInstancesGlobal?: PluginPanelGlobalInstanceSnapshot[];
  openInstance?: RendererPluginContext["panels"]["openInstance"];
}): RendererPluginContext {
  const openInstance =
    overrides?.openInstance ??
    vi.fn<RendererPluginContext["panels"]["openInstance"]>();
  const listInstances = overrides?.listInstances ?? [];
  const listInstancesGlobal = overrides?.listInstancesGlobal ?? [];
  const focusInstance =
    overrides?.focusInstance ??
    vi.fn<RendererPluginContext["panels"]["focusInstance"]>(async () => ({
      kind: "focused" as const,
    }));

  return {
    actions: { register: vi.fn() },
    commands: { register: vi.fn(), invoke: vi.fn() },
    configuration: { get: vi.fn(), set: vi.fn(), onChange: vi.fn() },
    environments: {} as RendererPluginContext["environments"],
    files: {} as RendererPluginContext["files"],
    git: {} as RendererPluginContext["git"],
    i18n: { t: vi.fn((key: string) => key), lang: "en" },
    workbenchWidgets: { register: vi.fn() },
    notifications: {
      error: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
      warning: vi.fn(),
    },
    panels: {
      getActiveContext: vi.fn(),
      getActiveInstanceId: vi.fn((componentId: string) =>
        componentId === FILES_FILE_PANEL_ID
          ? (overrides?.activeInstanceId ?? null)
          : null
      ),
      listInstances: vi.fn().mockReturnValue(listInstances),
      listInstancesGlobal: vi.fn().mockResolvedValue(listInstancesGlobal),
      focusInstance,
      open: vi.fn(),
      openInstance,
      register: vi.fn(),
      registerCloseGuard: vi.fn(),
    },
    commandPalette: { openQuickPick: vi.fn() },
    settings: { openSection: vi.fn() },
    terminal: {} as RendererPluginContext["terminal"],
    terminalStatusItems: { register: vi.fn() },
    worktrees: {} as RendererPluginContext["worktrees"],
  } as unknown as RendererPluginContext;
}

describe("openProjectFiles", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns no-anchor when context lacks project fields", async () => {
    const plugin = makePlugin();
    const result = await openProjectFiles(plugin, {
      contextId: "x",
      projectRootPath: "",
      updatedAt: 1,
    } as PanelContext);
    expect(result).toEqual({ ok: false, reason: "no-anchor" });
  });

  it("opens a new empty files instance for the project root", async () => {
    const openInstance = vi.fn();
    const plugin = makePlugin({ listInstances: [], openInstance });
    const expand = vi.spyOn(prefs, "ensureProjectFileTreeExpanded");
    expect(await openProjectFiles(plugin, baseContext)).toEqual({ ok: true });
    expect(openInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        componentId: FILES_FILE_PANEL_ID,
        context: baseContext,
        params: {},
      })
    );
    expect(expand).toHaveBeenCalledWith("/Users/a/proj");
    expand.mockRestore();
  });

  it("reuses an existing project-directory instance for the same anchor", async () => {
    const openInstance = vi.fn();
    const plugin = makePlugin({
      listInstances: [
        {
          id: "existing-id",
          componentId: FILES_FILE_PANEL_ID,
          groupId: "g1",
          title: "proj",
          params: {
            context: baseContext,
          },
        },
      ],
      openInstance,
    });
    await openProjectFiles(plugin, baseContext);
    expect(openInstance).toHaveBeenCalledWith(
      expect.objectContaining({ instanceId: "existing-id" })
    );
  });

  it("does not treat an open file editor as the project directory tab", async () => {
    const openInstance = vi.fn();
    const plugin = makePlugin({
      listInstances: [
        {
          id: "file-editor",
          componentId: FILES_FILE_PANEL_ID,
          groupId: "g1",
          title: "a.ts",
          params: {
            context: baseContext,
            source: { kind: "disk", path: "a.ts", root: "/Users/a/proj" },
          },
        },
      ],
      openInstance,
    });
    await openProjectFiles(plugin, baseContext);
    expect(openInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceId: expect.stringContaining(":project:"),
        params: {},
      })
    );
  });

  it("focuses a project directory in another window instead of opening again", async () => {
    const openInstance = vi.fn();
    const focusInstance = vi.fn(async () => ({ kind: "focused" as const }));
    const remoteId = createProjectFilesInstanceId("/Users/a/proj");
    const plugin = makePlugin({
      focusInstance,
      listInstances: [],
      listInstancesGlobal: [
        {
          componentId: FILES_FILE_PANEL_ID,
          groupId: null,
          id: remoteId,
          title: "proj",
          windowId: "win-remote",
          params: { context: baseContext },
        },
      ],
      openInstance,
    });

    expect(await openProjectFiles(plugin, baseContext)).toEqual({ ok: true });
    expect(focusInstance).toHaveBeenCalledWith({
      componentId: FILES_FILE_PANEL_ID,
      instanceId: remoteId,
      windowId: "win-remote",
    });
    expect(openInstance).not.toHaveBeenCalled();
  });

  it("does not reopen or reveal when the project files panel is already active", async () => {
    const openInstance = vi.fn();
    const reveal = vi
      .spyOn(treeRegistry, "revealFilesTreePath")
      .mockReturnValue(true);
    const expand = vi.spyOn(prefs, "ensureProjectFileTreeExpanded");
    const plugin = makePlugin({
      activeInstanceId: "existing-id",
      listInstances: [
        {
          id: "existing-id",
          componentId: FILES_FILE_PANEL_ID,
          groupId: "g1",
          title: "proj",
          params: { context: baseContext },
        },
      ],
      openInstance,
    });

    expect(await openProjectFiles(plugin, baseContext)).toEqual({ ok: true });
    expect(openInstance).not.toHaveBeenCalled();
    expect(expand).not.toHaveBeenCalled();
    vi.advanceTimersByTime(80);
    expect(reveal).not.toHaveBeenCalled();

    expand.mockRestore();
    reveal.mockRestore();
  });

  it("schedules reveal after open", async () => {
    const reveal = vi
      .spyOn(treeRegistry, "revealFilesTreePath")
      .mockReturnValue(true);
    const plugin = makePlugin({ listInstances: [], openInstance: vi.fn() });
    await openProjectFiles(plugin, baseContext);
    expect(reveal).not.toHaveBeenCalled();
    vi.advanceTimersByTime(80);
    expect(reveal).toHaveBeenCalledWith(
      expect.objectContaining({ root: "/Users/a/proj" })
    );
    reveal.mockRestore();
  });
});
