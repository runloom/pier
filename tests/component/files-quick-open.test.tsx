import type {
  RendererPluginContext,
  RendererPluginQuickPick,
  RendererPluginQuickPickItem,
} from "@plugins/api/renderer.ts";
import { FILES_FILE_PANEL_ID } from "@plugins/builtin/files/manifest.ts";
import { createFilesQuickOpenAction } from "@plugins/builtin/files/renderer/files-quick-open.ts";
import {
  __resetFilesPathMruForTests,
  listFilesPathMru,
} from "@plugins/builtin/files/renderer/files-quick-open-mru.ts";
import type {
  FilePathQueryStart,
  FileQueryEvent,
} from "@shared/contracts/file-query.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (event: FileQueryEvent) => void;

function createFakeQueryFacade() {
  const listeners = new Set<Listener>();
  const starts: FilePathQueryStart[] = [];
  const cancels: string[] = [];
  let nextId = 0;

  return {
    cancels,
    emit(event: FileQueryEvent) {
      for (const listener of listeners) {
        listener(event);
      }
    },
    onPathQueryEvent(listener: Listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    queryPaths(
      request: Omit<FilePathQueryStart, "queryId"> & { queryId?: string }
    ) {
      const queryId = request.queryId ?? `q-${nextId++}`;
      const start: FilePathQueryStart = {
        limit: request.limit ?? 200,
        mruPaths: request.mruPaths ?? [],
        options: request.options ?? {},
        owner: request.owner,
        query: request.query,
        queryId,
        root: request.root,
      };
      starts.push(start);
      return {
        cancel: () => {
          cancels.push(queryId);
        },
        queryId,
        started: Promise.resolve(true),
      };
    },
    starts,
  };
}

function createMockContext(input: {
  activeContext?: PanelContext | null;
  activePanelId?: string | null;
  instances?: {
    groupId?: string;
    id: string;
    params?: Record<string, unknown>;
  }[];
  query: ReturnType<typeof createFakeQueryFacade>;
}): {
  context: RendererPluginContext;
  openInstance: ReturnType<typeof vi.fn>;
  openQuickPick: ReturnType<typeof vi.fn>;
  updateQuickPick: ReturnType<typeof vi.fn>;
} {
  const openQuickPick = vi.fn();
  const updateQuickPick = vi.fn();
  const openInstance = vi.fn();
  const instances = input.instances ?? [];

  const context = {
    commandPalette: {
      openQuickPick,
      updateQuickPick,
    },
    configuration: {
      get: vi.fn((key: string) => {
        if (key === "pier.files.tree.excludePatterns") {
          return "**/custom-dist";
        }
        return;
      }),
      onDidChange: vi.fn(() => () => undefined),
    },
    files: {
      onPathQueryEvent: input.query.onPathQueryEvent.bind(input.query),
      queryPaths: input.query.queryPaths.bind(input.query),
    },
    i18n: {
      lang: "en",
      t: (key: string, _values?: unknown, fallback?: string) => fallback ?? key,
    },
    panels: {
      getActiveContext: vi.fn(() => input.activeContext ?? null),
      getActiveInstanceId: vi.fn((componentId: string) =>
        componentId === FILES_FILE_PANEL_ID
          ? (input.activePanelId ?? null)
          : null
      ),
      listInstances: vi.fn((componentId: string) =>
        componentId === FILES_FILE_PANEL_ID ? instances : []
      ),
      openInstance,
    },
  } as unknown as RendererPluginContext;

  return { context, openInstance, openQuickPick, updateQuickPick };
}

function lastQuickPick(
  openQuickPick: ReturnType<typeof vi.fn>
): RendererPluginQuickPick {
  const pick = openQuickPick.mock.calls.at(-1)?.[0] as
    | RendererPluginQuickPick
    | undefined;
  if (!pick) {
    throw new Error("expected openQuickPick to be called");
  }
  return pick;
}

describe("files quick open", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetFilesPathMruForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    __resetFilesPathMruForTests();
  });

  it("shows a disabled empty state when no project root is available", async () => {
    const query = createFakeQueryFacade();
    const { context, openQuickPick } = createMockContext({
      activeContext: null,
      query,
    });

    const action = createFilesQuickOpenAction(context);
    await action.handler();

    expect(openQuickPick).toHaveBeenCalledOnce();
    const pick = lastQuickPick(openQuickPick);
    expect(pick.items).toEqual([
      expect.objectContaining({
        disabled: true,
        id: "files.quickOpen.noProject",
        label: "Open a project to search files.",
      }),
    ]);
    expect(pick.onQueryChange).toBeUndefined();
    expect(query.starts).toHaveLength(0);
  });

  it("opens an async quick pick and streams path query results into updateQuickPick", async () => {
    const query = createFakeQueryFacade();
    const root = "/repo";
    const { context, openQuickPick, updateQuickPick } = createMockContext({
      activeContext: {
        contextId: "ctx:1",
        projectRootPath: root,
        updatedAt: 1,
      },
      activePanelId: "panel-1",
      instances: [{ groupId: "group-1", id: "panel-1" }],
      query,
    });

    const action = createFilesQuickOpenAction(context);
    await action.handler();

    const pick = lastQuickPick(openQuickPick);
    expect(pick.loading).toBe(true);
    expect(pick.onQueryChange).toEqual(expect.any(Function));
    expect(pick.placeholder).toBe("Search files by path");

    const controller = new AbortController();
    const onQueryChange = pick.onQueryChange;
    if (!onQueryChange) {
      throw new Error("expected onQueryChange");
    }
    await onQueryChange("theme.ts", controller.signal);
    await vi.advanceTimersByTimeAsync(80);

    expect(query.starts).toHaveLength(1);
    expect(query.starts[0]).toMatchObject({
      owner: expect.stringMatching(/^quick-open:/),
      query: "theme.ts",
      root,
    });

    const queryId = query.starts[0]?.queryId;
    if (!queryId) {
      throw new Error("expected queryId");
    }

    query.emit({ kind: "started", queryId });
    query.emit({
      items: [
        {
          path: "src/plugins/builtin/files/renderer/code-mirror-editor-theme.ts",
          score: 100,
        },
        { path: "src/main/ipc/theme.ts", score: 90 },
      ],
      kind: "batch",
      queryId,
    });
    query.emit({
      elapsedMs: 12,
      kind: "done",
      queryId,
      reason: "completed",
      scanned: 2,
      truncated: false,
    });

    expect(updateQuickPick).toHaveBeenCalled();
    const lastPatch = updateQuickPick.mock.calls.at(-1)?.[0] as {
      items?: RendererPluginQuickPickItem[];
      loading?: boolean;
    };
    expect(lastPatch.loading).toBe(false);
    expect(lastPatch.items?.map((item) => item.id)).toEqual([
      "src/plugins/builtin/files/renderer/code-mirror-editor-theme.ts",
      "src/main/ipc/theme.ts",
    ]);
    expect(lastPatch.items?.[0]).toMatchObject({
      description:
        "src/plugins/builtin/files/renderer/code-mirror-editor-theme.ts",
      label: "code-mirror-editor-theme.ts",
    });
  });

  it("opens the accepted path in the active group and records MRU", async () => {
    const query = createFakeQueryFacade();
    const root = "/repo";
    const panelContext: PanelContext = {
      contextId: "ctx:1",
      projectRootPath: root,
      updatedAt: 1,
    };
    const { context, openInstance, openQuickPick } = createMockContext({
      activeContext: panelContext,
      activePanelId: "panel-1",
      instances: [{ groupId: "group-1", id: "panel-1" }],
      query,
    });

    const action = createFilesQuickOpenAction(context);
    await action.handler();
    const pick = lastQuickPick(openQuickPick);

    const relativePath =
      "src/plugins/builtin/files/renderer/code-mirror-editor-theme.ts";
    await pick.onAccept({
      data: relativePath,
      description: relativePath,
      id: relativePath,
      label: "code-mirror-editor-theme.ts",
    });

    expect(openInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        componentId: FILES_FILE_PANEL_ID,
        context: panelContext,
        dropUnpinnedInstances: true,
        params: {
          pinned: false,
          source: {
            kind: "disk",
            path: relativePath,
            root,
          },
        },
        targetGroupId: "group-1",
        title: "code-mirror-editor-theme.ts",
      })
    );
    expect(listFilesPathMru(root)).toEqual([relativePath]);
  });

  it("reuses the same-source tab in the active group instead of recreating", async () => {
    const query = createFakeQueryFacade();
    const root = "/repo";
    const relativePath = "src/main/ipc/theme.ts";
    const panelContext: PanelContext = {
      contextId: "ctx:1",
      projectRootPath: root,
      updatedAt: 1,
    };
    const { context, openInstance, openQuickPick } = createMockContext({
      activeContext: panelContext,
      activePanelId: "panel-1",
      instances: [
        {
          groupId: "group-1",
          id: "existing-file-tab",
          params: {
            pinned: true,
            source: { kind: "disk", path: relativePath, root },
          },
        },
        { groupId: "group-1", id: "panel-1" },
      ],
      query,
    });

    const action = createFilesQuickOpenAction(context);
    await action.handler();
    const pick = lastQuickPick(openQuickPick);

    await pick.onAccept({
      data: relativePath,
      description: relativePath,
      id: relativePath,
      label: "theme.ts",
    });

    expect(openInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        componentId: FILES_FILE_PANEL_ID,
        dropUnpinnedInstances: false,
        instanceId: "existing-file-tab",
        params: {
          pinned: true,
          source: { kind: "disk", path: relativePath, root },
        },
        targetGroupId: "group-1",
      })
    );
    expect(openInstance.mock.calls[0]?.[0]).not.toHaveProperty("context");
  });

  it("cancels the in-flight path query when the AbortSignal aborts", async () => {
    const query = createFakeQueryFacade();
    const { context, openQuickPick } = createMockContext({
      activeContext: {
        contextId: "ctx:1",
        projectRootPath: "/repo",
        updatedAt: 1,
      },
      query,
    });

    const action = createFilesQuickOpenAction(context);
    await action.handler();
    const pick = lastQuickPick(openQuickPick);
    const onQueryChange = pick.onQueryChange;
    if (!onQueryChange) {
      throw new Error("expected onQueryChange");
    }

    const controller = new AbortController();
    await onQueryChange("a", controller.signal);
    await vi.advanceTimersByTimeAsync(80);
    expect(query.starts).toHaveLength(1);
    const queryId = query.starts[0]?.queryId;
    expect(queryId).toBeTruthy();

    controller.abort();
    expect(query.cancels).toContain(queryId);
  });

  it("passes the tree excludePatterns setting into the path query", async () => {
    const query = createFakeQueryFacade();
    const { context, openQuickPick } = createMockContext({
      activeContext: {
        contextId: "ctx:1",
        projectRootPath: "/repo",
        updatedAt: 1,
      },
      query,
    });

    const action = createFilesQuickOpenAction(context);
    await action.handler();
    const pick = lastQuickPick(openQuickPick);
    const onQueryChange = pick.onQueryChange;
    if (!onQueryChange) {
      throw new Error("expected onQueryChange");
    }
    await onQueryChange("theme", new AbortController().signal);
    await vi.advanceTimersByTimeAsync(80);

    expect(query.starts[0]?.options?.excludePatterns).toBe("**/custom-dist");
  });

  it("opens with preserveItemOrder so main ranking is not re-sorted", async () => {
    const query = createFakeQueryFacade();
    const { context, openQuickPick } = createMockContext({
      activeContext: {
        contextId: "ctx:1",
        projectRootPath: "/repo",
        updatedAt: 1,
      },
      query,
    });

    const action = createFilesQuickOpenAction(context);
    await action.handler();
    const pick = lastQuickPick(openQuickPick);
    expect(pick.preserveItemOrder).toBe(true);
  });
});
