import { isFileTreeEditingKeyEvent } from "@pier/ui/file/tree-selection-model.ts";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { FileEntry } from "@shared/contracts/file.ts";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { FileEditorController } from "../editor/controller.ts";
import type { FilesTranslate } from "../i18n.ts";
import {
  createFileClipboardCopyAction,
  createFileClipboardCutAction,
  createFileClipboardPasteAction,
} from "./actions-clipboard.ts";
import { createDeleteAction } from "./delete-action.ts";
import {
  type FilesTreeSearchKeyHandlers,
  handleFilesTreeSearchKeyDown,
} from "./search-keydown.ts";

function invocationForSelection(options: {
  entriesByPath: ReadonlyMap<string, FileEntry>;
  instanceId: string;
  projectRoot?: string;
  root: string;
  selectedPaths: readonly string[];
}): {
  metadata: Record<string, unknown>;
  surface: "files/tree-item";
} | null {
  const path = options.selectedPaths[0];
  if (path == null) {
    return null;
  }
  const entry = options.entriesByPath.get(path);
  if (!entry) {
    return null;
  }
  const entryKinds: Record<string, "directory" | "file"> = {};
  for (const selected of options.selectedPaths) {
    const selectedEntry = options.entriesByPath.get(selected);
    if (selectedEntry) {
      entryKinds[selected] = selectedEntry.kind;
    }
  }
  return {
    metadata: {
      entryKinds,
      kind: entry.kind,
      path: entry.path,
      root: options.root,
      treeId: options.instanceId,
      ...(options.projectRoot ? { projectRoot: options.projectRoot } : {}),
      ...(options.selectedPaths.length > 1
        ? { selectedPaths: [...options.selectedPaths] }
        : {}),
    },
    surface: "files/tree-item",
  };
}

export function handleFilesTreeKeyDown(
  event: KeyboardEvent,
  options: {
    context: RendererPluginContext;
    controller: FileEditorController;
    entriesByPath: ReadonlyMap<string, FileEntry>;
    instanceId: string;
    projectRoot?: string;
    root: string;
    selectedPaths: readonly string[];
    t: FilesTranslate;
  }
): void {
  if (event.repeat || isFileTreeEditingKeyEvent(event)) {
    return;
  }
  const invocation = invocationForSelection(options);
  if (!invocation) {
    return;
  }
  const mod = event.metaKey || event.ctrlKey;
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    Promise.resolve(
      createDeleteAction(
        options.context,
        options.t,
        options.controller
      ).handler(invocation)
    ).catch(() => undefined);
    return;
  }
  if (mod && event.key.toLowerCase() === "x") {
    event.preventDefault();
    createFileClipboardCutAction(options.context, options.t).handler(
      invocation
    );
    return;
  }
  if (mod && event.key.toLowerCase() === "c") {
    event.preventDefault();
    createFileClipboardCopyAction(options.context, options.t).handler(
      invocation
    );
    return;
  }
  if (mod && event.key.toLowerCase() === "v") {
    event.preventDefault();
    Promise.resolve(
      createFileClipboardPasteAction(options.context, options.t).handler(
        invocation
      )
    ).catch(() => undefined);
  }
}

export function handleFilesTreeSidebarKeyDown(
  event: ReactKeyboardEvent<HTMLElement>,
  search: Omit<FilesTreeSearchKeyHandlers, "searchActionsDisabled">,
  searchActionsDisabled: boolean,
  tree: Parameters<typeof handleFilesTreeKeyDown>[1]
): void {
  handleFilesTreeSearchKeyDown(event, { ...search, searchActionsDisabled });
  handleFilesTreeKeyDown(event.nativeEvent, tree);
}
