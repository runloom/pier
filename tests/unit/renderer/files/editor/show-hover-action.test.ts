import type {
  RendererPluginAction,
  RendererPluginActionInvocation,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import {
  FILES_EDITOR_SHOW_HOVER_COMMAND_ID,
  FILES_FILE_PANEL_ID,
  FILES_PLUGIN_MANIFEST,
} from "@plugins/builtin/files/manifest.ts";
import { createFilesEditorActions } from "@plugins/builtin/files/renderer/editor/actions.ts";
import type { FileEditorController } from "@plugins/builtin/files/renderer/editor/controller.ts";
import { createFileEditorSessionId } from "@plugins/builtin/files/renderer/editor/session-id.ts";
import { describe, expect, it, vi } from "vitest";

type HoverResult = "shown" | "queued" | "unavailable";

const PANEL_ID = "panel-1";
const DOCUMENT_ID = "document-1";
const EDITOR_SESSION_ID = "editor-session-1";

function createHarness(
  options: {
    activePanelId?: string | null;
    documentId?: string | null;
    result?: HoverResult;
  } = {}
) {
  const activePanelId =
    options.activePanelId === undefined ? PANEL_ID : options.activePanelId;
  const documentId =
    options.documentId === undefined ? DOCUMENT_ID : options.documentId;
  const notifications = {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  };
  const t = vi.fn(
    (_key: string, _values?: unknown, fallback?: string) => fallback ?? ""
  );
  const getActiveInstanceId = vi.fn(() => activePanelId);
  const context = {
    i18n: { t },
    notifications,
    panels: { getActiveInstanceId },
  } as unknown as RendererPluginContext;
  const documentIdForPanel = vi.fn(() => documentId);
  let deferredCompletion: ((result: HoverResult) => void) | undefined;
  const showLspHover = vi.fn(
    async (
      _editorSessionId: string,
      _documentId: string,
      onDeferredResult?: (result: HoverResult) => void
    ) => {
      deferredCompletion = onDeferredResult;
      return options.result ?? "shown";
    }
  );
  const showSourceMode = vi.fn();
  const controller = {
    documentIdForPanel,
    showLspHover,
    showSourceMode,
  } as unknown as FileEditorController;
  const action = createFilesEditorActions(context, controller).find(
    (candidate) => candidate.id === FILES_EDITOR_SHOW_HOVER_COMMAND_ID
  );

  return {
    completeDeferred(result: HoverResult) {
      deferredCompletion?.(result);
    },
    action,
    controller: { documentIdForPanel, showLspHover, showSourceMode },
    context: { getActiveInstanceId, notifications, t },
  };
}

function requireAction(action: RendererPluginAction | undefined) {
  if (!action) {
    throw new Error("Show Hover action is not registered");
  }
  return action;
}

function editorInvocation(): RendererPluginActionInvocation {
  return {
    metadata: {
      documentId: DOCUMENT_ID,
      editorSessionId: EDITOR_SESSION_ID,
    },
    surface: "files/editor",
  };
}

describe("Files Show Hover action declaration", () => {
  it("declares the stable command ID in the Files manifest", () => {
    expect(FILES_EDITOR_SHOW_HOVER_COMMAND_ID).toBe(
      "pier.files.editor.showHover"
    );
    expect(
      FILES_PLUGIN_MANIFEST.commands.find(
        (command) => command.id === FILES_EDITOR_SHOW_HOVER_COMMAND_ID
      )
    ).toEqual({
      category: "file",
      id: FILES_EDITOR_SHOW_HOVER_COMMAND_ID,
      permissions: [],
      title: "Show Symbol Information",
    });
  });

  it("exposes the action on command and editor surfaces after Go to Line", () => {
    const harness = createHarness();
    const action = requireAction(harness.action);

    expect(action).toMatchObject({
      category: "file",
      id: FILES_EDITOR_SHOW_HOVER_COMMAND_ID,
      metadata: { group: "1_navigation", sortOrder: 2 },
      surfaces: ["command-palette", "files/editor"],
    });
    expect(action.title()).toBe("Show Symbol Information");
    expect(harness.context.t).toHaveBeenCalledWith(
      "filePanel.editor.showHover.title",
      undefined,
      "Show Symbol Information"
    );
  });
});

describe("Files Show Hover action routing", () => {
  it("uses editor invocation metadata without consulting the active panel", async () => {
    const harness = createHarness();

    await requireAction(harness.action).handler(editorInvocation());

    expect(harness.controller.showLspHover).toHaveBeenCalledWith(
      EDITOR_SESSION_ID,
      DOCUMENT_ID,
      expect.any(Function)
    );
    expect(harness.context.getActiveInstanceId).not.toHaveBeenCalled();
    expect(harness.controller.documentIdForPanel).not.toHaveBeenCalled();
    expect(harness.controller.showSourceMode).not.toHaveBeenCalled();
  });

  it("routes an invocation from preview or diff through source mode first", async () => {
    const harness = createHarness({ result: "queued" });

    await requireAction(harness.action).handler(undefined);

    expect(harness.context.getActiveInstanceId).toHaveBeenCalledWith(
      FILES_FILE_PANEL_ID
    );
    expect(harness.controller.documentIdForPanel).toHaveBeenCalledWith(
      PANEL_ID
    );
    expect(harness.controller.showSourceMode).toHaveBeenCalledWith(PANEL_ID);
    expect(harness.controller.showLspHover).toHaveBeenCalledWith(
      createFileEditorSessionId(PANEL_ID),
      DOCUMENT_ID,
      expect.any(Function)
    );
    expect(
      harness.controller.showSourceMode.mock.invocationCallOrder[0]
    ).toBeLessThan(
      harness.controller.showLspHover.mock.invocationCallOrder[0] ??
        Number.POSITIVE_INFINITY
    );
  });

  it.each([
    ["there is no active Files panel", { activePanelId: null }],
    ["the active Files panel has no document", { documentId: null }],
  ])("reports a localized error when %s", async (_name, options) => {
    const harness = createHarness(options);
    harness.context.t.mockImplementation(
      (key: string, _values?: unknown, fallback?: string) =>
        key === "filePanel.editor.showHover.noActiveFile"
          ? "请先在编辑器中打开文件。"
          : (fallback ?? "")
    );

    await requireAction(harness.action).handler(undefined);

    expect(harness.context.t).toHaveBeenCalledWith(
      "filePanel.editor.showHover.noActiveFile",
      undefined,
      "Open a file in the editor first."
    );
    expect(harness.context.notifications.error).toHaveBeenCalledOnce();
    expect(harness.context.notifications.error).toHaveBeenCalledWith(
      "请先在编辑器中打开文件。"
    );
    expect(harness.controller.showLspHover).not.toHaveBeenCalled();
  });

  it("reports a localized error when symbol information is unavailable", async () => {
    const harness = createHarness({ result: "unavailable" });
    harness.context.t.mockImplementation(
      (key: string, _values?: unknown, fallback?: string) =>
        key === "filePanel.editor.showHover.unavailable"
          ? "此处没有可用的符号信息。"
          : (fallback ?? "")
    );

    await requireAction(harness.action).handler(editorInvocation());

    expect(harness.context.t).toHaveBeenCalledWith(
      "filePanel.editor.showHover.unavailable",
      undefined,
      "Symbol information is unavailable here."
    );
    expect(harness.context.notifications.error).toHaveBeenCalledOnce();
    expect(harness.context.notifications.error).toHaveBeenCalledWith(
      "此处没有可用的符号信息。"
    );
  });

  it("reports unavailable when an attached queued intent completes later", async () => {
    const harness = createHarness({ result: "queued" });
    harness.context.t.mockImplementation(
      (key: string, _values?: unknown, fallback?: string) =>
        key === "filePanel.editor.showHover.unavailable"
          ? "此处没有可用的符号信息。"
          : (fallback ?? "")
    );

    await requireAction(harness.action).handler(undefined);
    expect(harness.context.notifications.error).not.toHaveBeenCalled();

    harness.completeDeferred("unavailable");

    expect(harness.context.notifications.error).toHaveBeenCalledOnce();
    expect(harness.context.notifications.error).toHaveBeenCalledWith(
      "此处没有可用的符号信息。"
    );
  });

  it.each([
    "queued",
    "shown",
  ] as const)("leaves %s feedback to the hover UI", async (result) => {
    const harness = createHarness({ result });

    await requireAction(harness.action).handler(editorInvocation());

    expect(harness.context.notifications.error).not.toHaveBeenCalled();
    expect(harness.context.notifications.info).not.toHaveBeenCalled();
    expect(harness.context.notifications.success).not.toHaveBeenCalled();
  });
});
