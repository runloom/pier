import type {
  RendererPluginAction,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import {
  FILES_FILE_PANEL_ID,
  FILES_OPEN_SELECTION_AS_MARKDOWN_COMMAND_ID,
  FILES_PLUGIN_MANIFEST,
} from "@plugins/builtin/files/manifest.ts";
import {
  clearFilesDocumentStore,
  createUntitledMarkdownDocument,
  getDocument,
} from "@plugins/builtin/files/renderer/files-document-store.ts";
import { filesRendererPlugin } from "@plugins/builtin/files/renderer/index.tsx";
import type { PanelContext } from "@shared/contracts/panel.ts";
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

interface CapturedRegistrations {
  actionDisposers: ReturnType<typeof vi.fn>[];
  actions: RendererPluginAction[];
  panelDisposers: ReturnType<typeof vi.fn>[];
  panelIds: string[];
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
  };

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
    files: {
      list: vi.fn(async () => []),
      move: vi.fn(async (request) => ({
        moved: true,
        newPath: request.newPath,
        oldPath: request.path,
        root: request.root,
      })),
      readText: vi.fn(async () => ""),
      trash: vi.fn(async (request) => ({
        path: request.path,
        root: request.root,
        trashed: true,
      })),
      writeText: vi.fn(async (request) => ({
        path: request.path,
        root: request.root,
        written: true,
      })),
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
            return "Markdown 内容预览";
          }
          if (key === "files.notifications.noTerminalSelection") {
            return "没有可打开的终端选区";
          }
          return fallback ?? key;
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
      open: vi.fn(),
      openInstance: vi.fn(),
      register: vi.fn((registration: { id: string }) => {
        const dispose = vi.fn();
        captured.panelIds.push(registration.id);
        captured.panelDisposers.push(dispose);
        return dispose;
      }),
    },
    terminal: {
      activePanelId: vi.fn(() => overrides?.activePanelId ?? "terminal-active"),
      readSelectionText:
        overrides?.readSelectionText ??
        vi.fn(async () => ({
          kind: "ok",
          text: "# Selected\n\nfrom terminal",
        })),
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

afterEach(() => {
  clearFilesDocumentStore();
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
    expect(action.title()).toBe("Markdown 内容预览");
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
    expect(openOptions?.instanceId).toBe("pier.files.untitled:1");
    expect(openOptions?.params).toEqual({
      source: {
        id: "pier.files.untitled:1",
        kind: "untitled",
        name: "Untitled-1.md",
      },
    });
    expect(JSON.stringify(openOptions?.params)).not.toContain(selection);
    expect(getDocument("pier.files.untitled:1")?.currentContents).toBe(
      selection
    );
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
      "没有可打开的终端选区"
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
});
