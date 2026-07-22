import type {
  RendererPluginAction,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import {
  FILES_FILE_PANEL_ID,
  FILES_OPEN_SELECTION_AS_MARKDOWN_COMMAND_ID,
  FILES_PLUGIN_MANIFEST,
  FILES_SAVE_COMMAND_ID,
  FILES_TREE_SEARCH_COMMAND_ID,
} from "@plugins/builtin/files/manifest.ts";
import {
  clearFilesDocumentStore,
  createUntitledMarkdownDocument,
  ensureDiskDocument,
  getDocument,
  markDocumentReadResult,
  updateDocumentContents,
} from "@plugins/builtin/files/renderer/files-document-store.ts";
import { clearFileTreeSidebarCache } from "@plugins/builtin/files/renderer/files-tree-registry.ts";
import { filesRendererPlugin } from "@plugins/builtin/files/renderer/index.tsx";
import type { IDockviewPanelProps } from "@shared/contracts/dockview.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const sourcePanelContext: PanelContext = {
  branch: "feature/files",
  contextId: "ctx-source",
  cwd: "/repo/source",
  gitRoot: "/repo/source",
  openedPath: "/repo/source",
  projectRootPath: "/repo/source",
  source: "panel",
  updatedAt: 1_772_100_000_000,
  worktreeKey: "/repo/source",
  worktreeRoot: "/repo/source",
};
const activePanelContext: PanelContext = {
  ...sourcePanelContext,
  contextId: "ctx-active",
  cwd: "/repo/active",
  projectRootPath: "/repo/active",
  worktreeKey: "/repo/active",
};
const PROJECT_ROOT = activePanelContext.projectRootPath;

function markLoadedText(documentId: string, contents: string): void {
  markDocumentReadResult(documentId, {
    canonicalPath: "README.md",
    contents,
    eol: "lf",
    format: { bom: false, encoding: "utf8" },
    kind: "text",
    mode: 0o644,
    path: "README.md",
    revision: "revision-1",
    root: PROJECT_ROOT,
    size: contents.length,
    writable: true,
  });
}
const UNTITLED_FILE_PANEL_INSTANCE_RE = /^pier\.files\.filePanel:untitled:/;

interface CapturedRegistrations {
  actionDisposers: ReturnType<typeof vi.fn>[];
  actions: RendererPluginAction[];
  panelComponents: unknown[];
  panelDisposers: ReturnType<typeof vi.fn>[];
  panelIds: string[];
  suspendParticipants: RendererPluginContext["lifecycle"]["beforeSuspend"] extends (
    participant: infer P
  ) => unknown
    ? P[]
    : never;
}

function createMockContext(overrides?: {
  activePanelId?: string | null;
  activePanelContext?: PanelContext | null;
  readSelectionText?: RendererPluginContext["terminal"]["readSelectionText"];
  translate?: RendererPluginContext["i18n"]["t"];
}): RendererPluginContext & { captured: CapturedRegistrations } {
  const captured: CapturedRegistrations = {
    actionDisposers: [],
    actions: [],
    panelDisposers: [],
    panelIds: [],
    panelComponents: [],
    suspendParticipants: [],
  };
  const drafts = new Map<
    string,
    { generation: number; updatedAt: number; value: string }
  >();
  const readText = vi.fn(async () => "");
  const stat = vi.fn(async (request: { path: string; root: string }) => ({
    exists: true,
    isDirectory: false,
    mtimeMs: 1,
    path: request.path,
    root: request.root,
    size: 0,
  }));
  const writeText = vi.fn(async (request) => ({
    path: request.path,
    root: request.root,
    mtimeMs: 1,
    written: true as const,
  }));

  const context = {
    actions: {
      register: vi.fn((action: RendererPluginAction) => {
        const dispose = vi.fn();
        captured.actions.push(action);
        captured.actionDisposers.push(dispose);
        return dispose;
      }),
    },
    captured,
    contentPreview: {
      close: vi.fn(),
      openImage: vi.fn(),
    },
    contextMenu: {
      popup: vi.fn(async () => undefined),
      registerSelectionSelectAllProvider: vi.fn(() => () => undefined),
      registerSelectionTextProvider: vi.fn(() => () => undefined),
    },
    dialogs: {
      alert: vi.fn(async () => undefined),
      choice: vi.fn(async () => "confirm" as const),
      confirm: vi.fn(async () => true),
      prompt: vi.fn(async () => null),
    },
    configuration: {
      get: vi.fn(() => false),
      onDidChange: vi.fn(() => vi.fn()),
      reset: vi.fn(async () => undefined),
      set: vi.fn(async () => undefined),
    },
    git: {
      getStatus: vi.fn(async () => ({
        branch: {
          ahead: 0,
          behind: 0,
          branch: "main",
          mergedIntoDefault: null,
          oid: "abc",
          upstream: null,
          upstreamGone: false,
        },
        counts: { conflict: 0, modified: 0, staged: 0, untracked: 0 },
        delta: null,
        files: [],
        remoteSync: null,
        repoState: { kind: "clean" },
        stashCount: 0,
      })),
      listIgnored: vi.fn(async () => []),
      watch: vi.fn(() => () => undefined),
    },
    files: {
      confirmDurability: vi.fn(async (request) => ({
        kind: "confirmed" as const,
        revision: request.expectedRevision,
      })),
      drafts: {
        claimLegacy: vi.fn(async () => ({ kind: "not-found" as const })),
        delete: vi.fn(async (key: string) => drafts.delete(key)),
        get: vi.fn(async (key: string) => {
          const draft = drafts.get(key);
          return draft ? { ...draft, bytes: draft.value.length, key } : null;
        }),
        listKeys: vi.fn(async () => [...drafts.keys()]),
        set: vi.fn(async (key: string, generation: number, value: string) => {
          const updatedAt = Date.now();
          drafts.set(key, { generation, updatedAt, value });
          return {
            bytes: value.length,
            generation,
            key,
            kind: "stored" as const,
            updatedAt,
          };
        }),
      },
      exists: vi.fn(async (request) => ({
        exists: true,
        path: request.path,
        root: request.root,
      })),
      list: vi.fn(async () => []),
      mkdir: vi.fn(async (request) => ({
        created: true,
        path: request.path,
        root: request.root,
      })),
      move: vi.fn(async (request) => ({
        moved: true,
        newPath: request.newPath,
        oldPath: request.path,
        root: request.root,
      })),
      inspectWriteTarget: vi.fn(async () => ({
        fileType: "text" as const,
        kind: "existing" as const,
        revision: "revision-1",
        size: 0,
      })),
      readDocument: vi.fn(async (request) => ({
        canonicalPath: request.path,
        contents: await readText(),
        eol: "lf" as const,
        format: { bom: false as const, encoding: "utf8" as const },
        kind: "text" as const,
        mode: 0o644,
        path: request.path,
        revision: "revision-1",
        root: request.root,
        size: 0,
        writable: true,
      })),
      readText,
      stat,
      trash: vi.fn(async (request) => ({
        path: request.path,
        root: request.root,
        trashed: true,
      })),
      watch: vi.fn(() => () => undefined),
      writeDocument: vi.fn(async (request) => {
        await writeText(request);
        return {
          committed: true as const,
          durability: "confirmed" as const,
          kind: "written" as const,
          mode: 0o644,
          mtimeMs: 2,
          revision: "revision-2",
          size: request.contents.length,
        };
      }),
      writeText,
    },
    i18n: {
      commandDescription: vi.fn(() => undefined),
      commandTitle: vi.fn(
        (_commandId: string, fallback?: string) => fallback ?? ""
      ),
      language: vi.fn(() => "zh-CN"),
      t:
        overrides?.translate ??
        vi.fn((key: string, _values?: unknown, fallback?: string) => {
          if (key === "files.actions.openSelectionAsMarkdown.title") {
            return "预览选中文本";
          }
          if (key === "files.notifications.noTerminalSelection") {
            return "请先在终端中选中文本。";
          }
          return fallback ?? key;
        }),
    },
    lifecycle: {
      beforeSuspend: vi.fn((participant) => {
        captured.suspendParticipants.push(participant);
        return vi.fn();
      }),
    },
    notifications: {
      error: vi.fn(),
      info: vi.fn(),
      loading: vi.fn(() => ({
        dismiss: vi.fn(),
        info: vi.fn(),
        success: vi.fn(),
      })),
      success: vi.fn(),
      system: vi.fn(async () => ({ shown: true })),
    },
    panels: {
      getActiveContext: vi.fn(() => overrides?.activePanelContext ?? null),
      getActiveInstanceId: vi.fn(() => overrides?.activePanelId ?? null),
      listInstances: vi.fn(() => []),
      open: vi.fn(),
      openInstance: vi.fn(),
      register: vi.fn((registration: { component: unknown; id: string }) => {
        const dispose = vi.fn();
        captured.panelIds.push(registration.id);
        captured.panelComponents.push(registration.component);
        captured.panelDisposers.push(dispose);
        return dispose;
      }),
      registerCloseGuard: vi.fn(() => vi.fn()),
    },
    terminal: {
      activePanelId: vi.fn(() => overrides?.activePanelId ?? "terminal-active"),
      getPanelContext: vi.fn(() => null),
      onOpenUrl: vi.fn(() => vi.fn()),
      readSelectionText:
        overrides?.readSelectionText ??
        vi.fn(async () => ({
          kind: "ok",
          text: "# Selected\n\nfrom terminal",
        })),
    },
    terminalStatusItems: {
      register: vi.fn(() => vi.fn()),
    },
  } as unknown as RendererPluginContext & { captured: CapturedRegistrations };

  return context;
}

function findOpenSelectionAction(context: { captured: CapturedRegistrations }) {
  const action = context.captured.actions.find(
    (candidate) => candidate.id === FILES_OPEN_SELECTION_AS_MARKDOWN_COMMAND_ID
  );
  expect(action).toBeDefined();
  return action as RendererPluginAction;
}

function findTreeSearchAction(context: { captured: CapturedRegistrations }) {
  const action = context.captured.actions.find(
    (candidate) => candidate.id === FILES_TREE_SEARCH_COMMAND_ID
  );
  expect(action).toBeDefined();
  return action as RendererPluginAction;
}

function findSaveAction(context: { captured: CapturedRegistrations }) {
  const action = context.captured.actions.find(
    (candidate) => candidate.id === FILES_SAVE_COMMAND_ID
  );
  expect(action).toBeDefined();
  return action as RendererPluginAction;
}

function findFileCloseGuard(
  context: RendererPluginContext
): NonNullable<
  Parameters<RendererPluginContext["panels"]["registerCloseGuard"]>[1]
> {
  const registerCloseGuard = context.panels.registerCloseGuard as ReturnType<
    typeof vi.fn
  >;
  const guard = registerCloseGuard.mock.calls.find(
    ([componentId]) => componentId === FILES_FILE_PANEL_ID
  )?.[1];
  expect(guard).toBeDefined();
  return guard as NonNullable<
    Parameters<RendererPluginContext["panels"]["registerCloseGuard"]>[1]
  >;
}

function createFilePanelProps(
  context: PanelContext,
  options: {
    panelId?: string;
    source?: { kind: "disk"; path: string; root: string };
  } = {}
): IDockviewPanelProps<Record<string, unknown>> {
  return {
    api: {
      id: options.panelId ?? "panel-test",
      isActive: true,
      isVisible: true,
      onDidActiveChange: () => ({ dispose: () => undefined }),
      onDidVisibilityChange: () => ({ dispose: () => undefined }),
      setTitle: () => undefined,
      updateParameters: () => undefined,
    },
    containerApi: {},
    params: { context, ...(options.source ? { source: options.source } : {}) },
  } as unknown as IDockviewPanelProps<Record<string, unknown>>;
}

async function spyOnOpenFilesTreeSearch() {
  const filesTreeRegistry = await import(
    "@plugins/builtin/files/renderer/files-tree-registry.ts"
  );
  return vi.spyOn(filesTreeRegistry, "openFilesTreeSearch");
}

afterEach(() => {
  cleanup();
  clearFilesDocumentStore();
  clearFileTreeSidebarCache();
  vi.restoreAllMocks();
});

describe("files terminal selection action", () => {
  it("declares only the shared file-panel and terminal selection command in the manifest", () => {
    expect(FILES_PLUGIN_MANIFEST.panels).toHaveLength(1);
    expect(FILES_PLUGIN_MANIFEST.panels[0]).toMatchObject({
      component: FILES_FILE_PANEL_ID,
      id: FILES_FILE_PANEL_ID,
    });

    const command = FILES_PLUGIN_MANIFEST.commands.find(
      (candidate) =>
        candidate.id === FILES_OPEN_SELECTION_AS_MARKDOWN_COMMAND_ID
    );
    expect(command).toBeDefined();
    expect(command?.permissions).toEqual(
      expect.arrayContaining(["terminal:read", "panel:open"])
    );
    expect(FILES_PLUGIN_MANIFEST.permissions).toEqual(
      expect.arrayContaining([
        "command:register",
        "panel:register",
        "panel:open",
        "file:read",
        "file:write",
        "terminal:read",
      ])
    );
  });

  it("registers the shared file-panel and the terminal/content context-menu action", () => {
    const context = createMockContext();

    filesRendererPlugin.activate(context);

    expect(context.captured.panelIds).toEqual([FILES_FILE_PANEL_ID]);
    const action = findOpenSelectionAction(context);
    expect(action.surfaces).toEqual(["terminal/content"]);
    expect(action.metadata).toMatchObject({ group: "0_edit", sortOrder: 6 });
    expect(action.title()).toBe("预览选中文本");
  });

  it("opens the source terminal selection as an untitled Markdown file-panel", async () => {
    const selection = "# Selected\n\nsecret body from terminal";
    const readSelectionText = vi.fn(async () => ({
      kind: "ok" as const,
      text: selection,
    }));
    const context = createMockContext({
      activePanelContext,
      activePanelId: "terminal-active",
      readSelectionText,
    });
    filesRendererPlugin.activate(context);

    await findOpenSelectionAction(context).handler({
      sourcePanelComponent: "terminal",
      sourcePanelContext,
      sourcePanelGroupId: "group-terminal-source",
      sourcePanelId: "terminal-source",
      surface: "terminal/content",
    });

    expect(context.terminal.activePanelId).not.toHaveBeenCalled();
    expect(context.panels.getActiveContext).not.toHaveBeenCalled();
    expect(readSelectionText).toHaveBeenCalledWith("terminal-source");
    expect(context.panels.openInstance).toHaveBeenCalledOnce();
    expect(context.panels.openInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        componentId: FILES_FILE_PANEL_ID,
        context: sourcePanelContext,
        title: "Untitled-1.md",
      })
    );

    const openOptions = vi.mocked(context.panels.openInstance).mock
      .calls[0]?.[0];
    expect(openOptions?.instanceId).toMatch(UNTITLED_FILE_PANEL_INSTANCE_RE);
    expect(openOptions?.instanceId).not.toBe("pier.files.untitled:1");
    expect(openOptions?.targetGroupId).toBe("group-terminal-source");
    expect(openOptions?.params).toEqual({
      // untitled Markdown 面板天然 pinned,防止 preview 语义关掉时把 localStorage
      // 草稿一起删。
      pinned: true,
      source: {
        id: expect.stringMatching(/^pier\.files\.untitled:[0-9a-f-]{36}$/),
        kind: "untitled",
        name: "Untitled-1.md",
      },
    });
    expect(JSON.stringify(openOptions?.params)).not.toContain(selection);
    const source = openOptions?.params?.source;
    expect(
      source && typeof source === "object" && "id" in source
        ? getDocument(String(source.id))?.currentContents
        : null
    ).toBe(selection);
  });

  it.each([
    [
      "missing source panel",
      undefined,
      { kind: "ok" as const, text: "# Text" },
    ],
    [
      "empty selection",
      "terminal-source",
      { kind: "ok" as const, text: "  \n\t" },
    ],
    ["empty selection result", "terminal-source", { kind: "empty" as const }],
    [
      "selection read error",
      "terminal-source",
      { kind: "error" as const, message: "missing" },
    ],
  ])("notifies without opening when there is no usable selection: %s", async (_caseName, sourcePanelId, selectionResult) => {
    const readSelectionText = vi.fn(async () => selectionResult);
    const context = createMockContext({ readSelectionText });
    filesRendererPlugin.activate(context);

    await findOpenSelectionAction(context).handler({
      ...(sourcePanelId ? { sourcePanelId } : {}),
      surface: "terminal/content",
    });

    if (sourcePanelId) {
      expect(readSelectionText).toHaveBeenCalledWith(sourcePanelId);
    } else {
      expect(readSelectionText).not.toHaveBeenCalled();
    }
    expect(context.panels.openInstance).not.toHaveBeenCalled();
    expect(context.notifications.info).toHaveBeenCalledWith(
      "请先在终端中选中文本。"
    );
  });

  it("clears file documents and disposes registrations on deactivate", () => {
    const context = createMockContext();
    const deactivate = filesRendererPlugin.activate(context);
    const document = createUntitledMarkdownDocument({ contents: "secret" });

    deactivate();

    const actionDispose = context.captured.actionDisposers[0];
    const filePanelDispose = context.captured.panelDisposers[0];
    expect(actionDispose).toBeDefined();
    expect(filePanelDispose).toBeDefined();
    expect(getDocument(document.id)).toBeNull();
    expect(actionDispose).toHaveBeenCalledOnce();
    expect(filePanelDispose).toHaveBeenCalledOnce();
    expect(actionDispose?.mock.invocationCallOrder[0]).toBeLessThan(
      filePanelDispose?.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
    );
  });

  it("unmounts rendered file panels when deactivated", async () => {
    const context = createMockContext();
    const deactivate = filesRendererPlugin.activate(context);
    const FilesPanel = context.captured.panelComponents[0] as
      | ComponentType<IDockviewPanelProps<Record<string, unknown>>>
      | undefined;
    expect(FilesPanel).toBeDefined();
    if (!FilesPanel) {
      throw new Error("expected Files file-panel registration");
    }

    const rendered = render(
      <FilesPanel {...createFilePanelProps(activePanelContext)} />
    );
    const filePanelDispose = context.captured.panelDisposers[0];
    filePanelDispose?.mockImplementation(() => {
      rendered.unmount();
    });
    await waitFor(() => {
      expect(
        document.querySelector('[aria-label="Collapse file tree"]')
      ).not.toBeNull();
    });

    deactivate();

    expect(filePanelDispose).toHaveBeenCalledOnce();
    expect(
      document.querySelector('[aria-label="Collapse file tree"]')
    ).toBeNull();
  });

  it("allows closing a dirty disk tab without discarding the shared document while another same-source tab remains", async () => {
    const source = {
      kind: "disk" as const,
      path: "README.md",
      root: PROJECT_ROOT,
    };
    const document = ensureDiskDocument(source);
    updateDocumentContents(document.id, "# dirty shared contents");
    const context = createMockContext();
    (context.panels.listInstances as ReturnType<typeof vi.fn>).mockReturnValue([
      {
        componentId: FILES_FILE_PANEL_ID,
        groupId: "group-a",
        id: "panel-a",
        params: { source },
        title: "README.md",
      },
      {
        componentId: FILES_FILE_PANEL_ID,
        groupId: "group-b",
        id: "panel-b",
        params: { source },
        title: "README.md",
      },
    ]);
    filesRendererPlugin.activate(context);
    const guard = findFileCloseGuard(context);

    const result = await guard({
      componentId: FILES_FILE_PANEL_ID,
      panelId: "panel-a",
      params: { source },
    });

    expect(result).toBe(true);
    expect(context.dialogs.choice).not.toHaveBeenCalled();
    expect(getDocument(document.id)).not.toBeNull();
  });

  it("prompts once when closeAll closes every same-source dirty disk tab", async () => {
    const source = {
      kind: "disk" as const,
      path: "README.md",
      root: PROJECT_ROOT,
    };
    const document = ensureDiskDocument(source);
    markLoadedText(document.id, "# saved contents");
    updateDocumentContents(document.id, "# dirty shared contents");
    const context = createMockContext();
    (context.dialogs.choice as ReturnType<typeof vi.fn>).mockResolvedValue(
      "confirm"
    );
    (context.panels.listInstances as ReturnType<typeof vi.fn>).mockReturnValue([
      {
        componentId: FILES_FILE_PANEL_ID,
        groupId: "group-a",
        id: "panel-a",
        params: { source },
        title: "README.md",
      },
      {
        componentId: FILES_FILE_PANEL_ID,
        groupId: "group-b",
        id: "panel-b",
        params: { source },
        title: "README.md",
      },
    ]);
    filesRendererPlugin.activate(context);
    const guard = findFileCloseGuard(context);

    await expect(
      guard({
        closingPanelIds: ["panel-a", "panel-b"],
        componentId: FILES_FILE_PANEL_ID,
        panelId: "panel-a",
        params: { source },
      })
    ).resolves.toBe(true);
    await expect(
      guard({
        closingPanelIds: ["panel-a", "panel-b"],
        componentId: FILES_FILE_PANEL_ID,
        panelId: "panel-b",
        params: { source },
      })
    ).resolves.toBe(true);

    expect(context.dialogs.choice).toHaveBeenCalledTimes(1);
    expect(context.files.writeDocument).toHaveBeenCalledTimes(1);
    expect(getDocument(document.id)?.dirty).toBe(false);
  });

  it("discards a dirty disk document only when the last same-source tab chooses dont-save", async () => {
    const source = {
      kind: "disk" as const,
      path: "README.md",
      root: PROJECT_ROOT,
    };
    const document = ensureDiskDocument(source);
    updateDocumentContents(document.id, "# dirty shared contents");
    const context = createMockContext();
    (context.dialogs.choice as ReturnType<typeof vi.fn>).mockResolvedValue(
      "alt"
    );
    (context.panels.listInstances as ReturnType<typeof vi.fn>).mockReturnValue([
      {
        componentId: FILES_FILE_PANEL_ID,
        groupId: "group-a",
        id: "panel-a",
        params: { source },
        title: "README.md",
      },
    ]);
    filesRendererPlugin.activate(context);
    const guard = findFileCloseGuard(context);

    const result = await guard({
      componentId: FILES_FILE_PANEL_ID,
      panelId: "panel-a",
      params: { source },
    });

    expect(result).toBe(true);
    expect(context.dialogs.choice).toHaveBeenCalledTimes(1);
    expect(getDocument(document.id)).toBeNull();
  });

  it("keeps a dirty disk document when the last same-source tab close is canceled", async () => {
    const source = {
      kind: "disk" as const,
      path: "README.md",
      root: PROJECT_ROOT,
    };
    const document = ensureDiskDocument(source);
    updateDocumentContents(document.id, "# dirty shared contents");
    const context = createMockContext();
    (context.dialogs.choice as ReturnType<typeof vi.fn>).mockResolvedValue(
      "cancel"
    );
    (context.panels.listInstances as ReturnType<typeof vi.fn>).mockReturnValue([
      {
        componentId: FILES_FILE_PANEL_ID,
        groupId: "group-a",
        id: "panel-a",
        params: { source },
        title: "README.md",
      },
    ]);
    filesRendererPlugin.activate(context);
    const guard = findFileCloseGuard(context);

    const result = await guard({
      componentId: FILES_FILE_PANEL_ID,
      panelId: "panel-a",
      params: { source },
    });

    expect(result).toBe(false);
    expect(context.dialogs.choice).toHaveBeenCalledTimes(1);
    expect(getDocument(document.id)).not.toBeNull();
  });

  it("saves a dirty inactive disk tab through the close guard", async () => {
    const source = {
      kind: "disk" as const,
      path: "README.md",
      root: PROJECT_ROOT,
    };
    const document = ensureDiskDocument(source);
    markLoadedText(document.id, "# saved contents");
    updateDocumentContents(document.id, "# dirty inactive contents");
    const context = createMockContext();
    (context.dialogs.choice as ReturnType<typeof vi.fn>).mockResolvedValue(
      "confirm"
    );
    (context.panels.listInstances as ReturnType<typeof vi.fn>).mockReturnValue([
      {
        componentId: FILES_FILE_PANEL_ID,
        groupId: "group-a",
        id: "panel-a",
        params: { source },
        title: "README.md",
      },
    ]);
    filesRendererPlugin.activate(context);
    const guard = findFileCloseGuard(context);

    const result = await guard({
      componentId: FILES_FILE_PANEL_ID,
      panelId: "panel-a",
      params: { source },
    });

    expect(result).toBe(true);
    expect(context.files.writeDocument).toHaveBeenCalledWith({
      contents: "# dirty inactive contents",
      eol: "lf",
      expected: { kind: "revision", revision: "revision-1" },
      format: { bom: false, encoding: "utf8" },
      path: "README.md",
      root: PROJECT_ROOT,
    });
    expect(getDocument(document.id)?.dirty).toBe(false);
    expect(getDocument(document.id)?.savedContents).toBe(
      "# dirty inactive contents"
    );
  });

  it("routes the registered save action to the active file panel", async () => {
    const panelId = "panel-save-action";
    const source = {
      kind: "disk" as const,
      path: "README.md",
      root: PROJECT_ROOT,
    };
    const context = createMockContext({
      activePanelContext,
      activePanelId: panelId,
    });
    filesRendererPlugin.activate(context);
    const FilesPanel = context.captured.panelComponents[0] as
      | ComponentType<IDockviewPanelProps<Record<string, unknown>>>
      | undefined;
    expect(FilesPanel).toBeDefined();
    if (!FilesPanel) throw new Error("expected Files panel registration");
    render(
      <FilesPanel
        {...createFilePanelProps(activePanelContext, { panelId, source })}
      />
    );
    const document = ensureDiskDocument(source);
    await waitFor(() =>
      expect(getDocument(document.id)?.loadState).toBe("loaded")
    );
    updateDocumentContents(document.id, "# saved through action");

    await findSaveAction(context).handler();

    expect(context.panels.getActiveInstanceId).toHaveBeenCalledWith(
      FILES_FILE_PANEL_ID
    );
    expect(context.files.writeDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        contents: "# saved through action",
        path: "README.md",
        root: PROJECT_ROOT,
      })
    );
  });

  it("opens tree search for the active file panel group instead of root fallback", async () => {
    const search = await spyOnOpenFilesTreeSearch();
    const context = createMockContext({
      activePanelContext,
      activePanelId: "active-file-panel",
    });
    (context.panels.listInstances as ReturnType<typeof vi.fn>).mockReturnValue([
      {
        componentId: FILES_FILE_PANEL_ID,
        groupId: "group-active",
        id: "active-file-panel",
        params: { context: activePanelContext },
        title: "README.md",
      },
    ]);
    filesRendererPlugin.activate(context);
    const action = findTreeSearchAction(context);

    await action.handler();

    expect(search).toHaveBeenCalledWith({
      instanceId: "group-active",
      root: PROJECT_ROOT,
    });
  });

  it("does not open tree search by root fallback when no active file panel group exists", async () => {
    const search = await spyOnOpenFilesTreeSearch();
    const context = createMockContext({
      activePanelContext,
      activePanelId: null,
    });
    (context.panels.listInstances as ReturnType<typeof vi.fn>).mockReturnValue(
      []
    );
    filesRendererPlugin.activate(context);
    const action = findTreeSearchAction(context);

    await action.handler();

    expect(search).not.toHaveBeenCalled();
  });

  it("does not open tree search when the active file panel has no group snapshot", async () => {
    const search = await spyOnOpenFilesTreeSearch();
    const context = createMockContext({
      activePanelContext,
      activePanelId: "active-file-panel",
    });
    (context.panels.listInstances as ReturnType<typeof vi.fn>).mockReturnValue([
      {
        componentId: FILES_FILE_PANEL_ID,
        groupId: null,
        id: "active-file-panel",
        params: { context: activePanelContext },
        title: "README.md",
      },
    ]);
    filesRendererPlugin.activate(context);
    const action = findTreeSearchAction(context);

    await action.handler();

    expect(search).not.toHaveBeenCalled();
  });
});
