import type {
  RendererPluginAction,
  RendererPluginActionInvocation,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import {
  FILES_COPY_PATH_COMMAND_ID,
  FILES_COPY_PATH_WITH_RANGE_COMMAND_ID,
  FILES_COPY_RELATIVE_PATH_COMMAND_ID,
  FILES_DELETE_COMMAND_ID,
  FILES_NEW_FILE_COMMAND_ID,
  FILES_NEW_FOLDER_COMMAND_ID,
  FILES_RENAME_COMMAND_ID,
} from "@plugins/builtin/files/manifest.ts";
import { createFilesTreeActions } from "@plugins/builtin/files/renderer/file-tree-actions.ts";
import {
  addFilesTreeEntry,
  clearFilesTreeStore,
  getFilesTreeSnapshot,
} from "@plugins/builtin/files/renderer/files-tree-store.ts";
import type {
  FilesNamePromptOptions,
  FilesNamePromptOutcome,
} from "@plugins/builtin/files/renderer/name-prompt.tsx";
import type { FileEntry } from "@shared/contracts/file.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

const showFilesNamePromptMock = vi.hoisted(() =>
  vi.fn<
    (
      context: RendererPluginContext,
      options: FilesNamePromptOptions
    ) => Promise<FilesNamePromptOutcome>
  >()
);

vi.mock("@plugins/builtin/files/renderer/name-prompt.tsx", () => ({
  showFilesNamePrompt: showFilesNamePromptMock,
}));

const ROOT = "/repo";
const ORIGINAL_CLIPBOARD_DESCRIPTOR = Object.getOwnPropertyDescriptor(
  globalThis.navigator,
  "clipboard"
);

function file(path: string): FileEntry {
  return { kind: "file", path, root: ROOT };
}

function directory(path: string): FileEntry {
  return { kind: "directory", path, root: ROOT };
}

function treeInvocation(metadata: FileEntry): RendererPluginActionInvocation {
  return { metadata, surface: "files/tree-item" };
}

function editorInvocation(
  metadata: RendererPluginActionInvocation["metadata"]
): RendererPluginActionInvocation {
  return metadata === undefined
    ? { surface: "files/editor" }
    : { metadata, surface: "files/editor" };
}

function actionById(
  actions: readonly RendererPluginAction[],
  id: string
): RendererPluginAction {
  const action = actions.find((candidate) => candidate.id === id);
  expect(action, `expected action ${id} to be registered`).toBeDefined();
  return action as RendererPluginAction;
}

function makeContext() {
  const files = {
    exists: vi.fn<RendererPluginContext["files"]["exists"]>(
      async (request) => ({
        exists: false,
        path: request.path,
        root: request.root,
      })
    ),
    list: vi.fn<RendererPluginContext["files"]["list"]>(async () => []),
    mkdir: vi.fn<RendererPluginContext["files"]["mkdir"]>(async (request) => ({
      created: true,
      path: request.path,
      root: request.root,
    })),
    move: vi.fn<RendererPluginContext["files"]["move"]>(async (request) => ({
      moved: true,
      newPath: request.newPath,
      oldPath: request.path,
      root: request.root,
    })),
    readText: vi.fn<RendererPluginContext["files"]["readText"]>(async () => ""),
    trash: vi.fn<RendererPluginContext["files"]["trash"]>(async (request) => ({
      path: request.path,
      root: request.root,
      trashed: true,
    })),
    stat: vi.fn(async (request) => ({
      exists: true,
      isDirectory: false,
      mtimeMs: 1,
      path: request.path,
      root: request.root,
      size: 0,
    })),
    watch: vi.fn(() => () => undefined),
    writeText: vi.fn<RendererPluginContext["files"]["writeText"]>(
      async (request) => ({
        path: request.path,
        root: request.root,
        mtimeMs: 1,
        written: true as const,
      })
    ),
  };
  const dialogs = {
    alert: vi.fn<RendererPluginContext["dialogs"]["alert"]>(
      async () => undefined
    ),
    confirm: vi.fn<RendererPluginContext["dialogs"]["confirm"]>(
      async () => true
    ),
    prompt: vi.fn<RendererPluginContext["dialogs"]["prompt"]>(async () => null),
  };
  const notifications = {
    error: vi.fn<RendererPluginContext["notifications"]["error"]>(),
    info: vi.fn<RendererPluginContext["notifications"]["info"]>(),
    loading: vi.fn<RendererPluginContext["notifications"]["loading"]>(() => ({
      dismiss: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
    })),
    success: vi.fn<RendererPluginContext["notifications"]["success"]>(),
    system: vi.fn<RendererPluginContext["notifications"]["system"]>(
      async () => ({ shown: true })
    ),
  };
  const context = {
    dialogs,
    files,
    i18n: {
      commandDescription: vi.fn(() => undefined),
      commandTitle: vi.fn(
        (_commandId: string, fallback?: string) => fallback ?? ""
      ),
      language: vi.fn(() => "en"),
      t: vi.fn(
        (
          _key: string,
          _values?: Record<string, number | string>,
          fallback?: string
        ) => fallback ?? _key
      ),
    },
    notifications,
  } as unknown as RendererPluginContext;

  return { context, dialogs, files, notifications };
}

function installClipboard() {
  const writeText = vi.fn<(text: string) => Promise<void>>(
    async () => undefined
  );
  Object.defineProperty(globalThis.navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  return writeText;
}

afterEach(() => {
  clearFilesTreeStore();
  showFilesNamePromptMock.mockReset();
  if (ORIGINAL_CLIPBOARD_DESCRIPTOR) {
    Object.defineProperty(
      globalThis.navigator,
      "clipboard",
      ORIGINAL_CLIPBOARD_DESCRIPTOR
    );
  } else {
    Reflect.deleteProperty(globalThis.navigator, "clipboard");
  }
  vi.restoreAllMocks();
});

describe("file-tree-actions", () => {
  it("creates a file through the file service and adds it to the tree only after the write succeeds", async () => {
    const { context, files } = makeContext();
    showFilesNamePromptMock.mockResolvedValueOnce({
      cancelled: false,
      value: "new.ts",
    });
    const action = actionById(
      createFilesTreeActions(context),
      FILES_NEW_FILE_COMMAND_ID
    );

    await action.handler(treeInvocation(directory("src")));

    expect(files.writeText).toHaveBeenCalledWith({
      contents: "",
      path: "src/new.ts",
      root: ROOT,
    });
    expect(getFilesTreeSnapshot(ROOT).entriesByPath.get("src/new.ts")).toEqual(
      file("src/new.ts")
    );
  });

  it("creates a folder through the file service and adds the directory entry to the tree", async () => {
    const { context, files } = makeContext();
    showFilesNamePromptMock.mockResolvedValueOnce({
      cancelled: false,
      value: "components",
    });
    const action = actionById(
      createFilesTreeActions(context),
      FILES_NEW_FOLDER_COMMAND_ID
    );

    await action.handler(treeInvocation(directory("src")));

    expect(files.mkdir).toHaveBeenCalledWith({
      path: "src/components",
      root: ROOT,
    });
    expect(
      getFilesTreeSnapshot(ROOT).entriesByPath.get("src/components")
    ).toEqual(directory("src/components"));
  });

  it("does not patch the tree when file creation fails", async () => {
    const { context, files, notifications } = makeContext();
    files.writeText.mockRejectedValueOnce(new Error("disk full"));
    showFilesNamePromptMock.mockResolvedValueOnce({
      cancelled: false,
      value: "new.ts",
    });
    const action = actionById(
      createFilesTreeActions(context),
      FILES_NEW_FILE_COMMAND_ID
    );

    await action.handler(treeInvocation(directory("src")));

    expect(notifications.error).toHaveBeenCalledWith("disk full");
    expect(getFilesTreeSnapshot(ROOT).entriesByPath.has("src/new.ts")).toBe(
      false
    );
  });

  it("renames through the file service and moves the existing tree entry on success", async () => {
    const { context, files } = makeContext();
    addFilesTreeEntry(ROOT, file("src/old.ts"));
    showFilesNamePromptMock.mockResolvedValueOnce({
      cancelled: false,
      value: "new.ts",
    });
    const action = actionById(
      createFilesTreeActions(context),
      FILES_RENAME_COMMAND_ID
    );

    await action.handler(treeInvocation(file("src/old.ts")));

    expect(files.move).toHaveBeenCalledWith({
      newPath: "src/new.ts",
      path: "src/old.ts",
      root: ROOT,
    });
    const snapshot = getFilesTreeSnapshot(ROOT);
    expect(snapshot.entriesByPath.has("src/old.ts")).toBe(false);
    expect(snapshot.entriesByPath.get("src/new.ts")).toEqual(
      file("src/new.ts")
    );
  });

  it("confirms delete with a destructive small dialog, trashes the file, and removes it from the tree", async () => {
    const { context, dialogs, files } = makeContext();
    addFilesTreeEntry(ROOT, file("src/delete-me.ts"));
    const action = actionById(
      createFilesTreeActions(context),
      FILES_DELETE_COMMAND_ID
    );

    await action.handler(treeInvocation(file("src/delete-me.ts")));

    expect(dialogs.confirm).toHaveBeenCalledWith({
      body: 'Move "delete-me.ts" to the system trash?',
      cancelLabel: "Cancel",
      confirmLabel: "Move to Trash",
      intent: "destructive",
      size: "sm",
      title: "Move to Trash",
    });
    expect(files.trash).toHaveBeenCalledWith({
      path: "src/delete-me.ts",
      root: ROOT,
    });
    expect(
      getFilesTreeSnapshot(ROOT).entriesByPath.has("src/delete-me.ts")
    ).toBe(false);
  });

  it("leaves the file untouched when delete confirmation is cancelled", async () => {
    const { context, dialogs, files } = makeContext();
    dialogs.confirm.mockResolvedValueOnce(false);
    addFilesTreeEntry(ROOT, file("src/keep.ts"));
    const action = actionById(
      createFilesTreeActions(context),
      FILES_DELETE_COMMAND_ID
    );

    await action.handler(treeInvocation(file("src/keep.ts")));

    expect(files.trash).not.toHaveBeenCalled();
    expect(getFilesTreeSnapshot(ROOT).entriesByPath.get("src/keep.ts")).toEqual(
      file("src/keep.ts")
    );
  });

  it("copies absolute and relative tree paths to the clipboard", async () => {
    const { context } = makeContext();
    const writeClipboardText = installClipboard();
    const actions = createFilesTreeActions(context);

    await actionById(actions, FILES_COPY_PATH_COMMAND_ID).handler(
      treeInvocation(file("src/index.ts"))
    );
    await actionById(actions, FILES_COPY_RELATIVE_PATH_COMMAND_ID).handler(
      treeInvocation(file("src/index.ts"))
    );

    expect(writeClipboardText).toHaveBeenNthCalledWith(1, "/repo/src/index.ts");
    expect(writeClipboardText).toHaveBeenNthCalledWith(2, "src/index.ts");
  });

  it("copies editor paths with a project-relative line range", async () => {
    const { context } = makeContext();
    const writeClipboardText = installClipboard();
    const action = actionById(
      createFilesTreeActions(context),
      FILES_COPY_PATH_WITH_RANGE_COMMAND_ID
    );

    await action.handler(
      editorInvocation({
        path: "src/index.ts",
        projectRoot: "/repo",
        root: "/repo/packages/app",
        selectionEndLine: 58,
        selectionStartLine: 42,
      })
    );

    expect(writeClipboardText).toHaveBeenCalledWith(
      "packages/app/src/index.ts:42-58"
    );
  });
});
