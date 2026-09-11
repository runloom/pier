import type { FileTreeItemHandle } from "@pierre/trees";
import { isDirectoryHandle } from "./tree-model.ts";

export interface FileTreeSelectionModifiers {
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}

export interface FileTreeSelectionModel {
  readonly focusPath: (path: string) => void;
  readonly getSelectedPaths: () => readonly string[];
  readonly replaceSelectedPaths: (paths: readonly string[]) => void;
  readonly selectOnlyPath: (path: string) => void;
  readonly selectPathRange: (path: string, unionSelection: boolean) => void;
  readonly togglePathSelectionFromInput: (path: string) => void;
}

export interface FileTreeHostKeyModel extends FileTreeSelectionModel {
  readonly getFocusedPath: () => string | null;
  readonly getItem: (path: string) => FileTreeItemHandle | null;
  readonly isSearchOpen: () => boolean;
}

export function bindFileTreeSelectionApi(modelRef: {
  current: FileTreeSelectionModel;
}): FileTreeSelectionModel {
  return {
    focusPath: (path) => {
      modelRef.current.focusPath(path);
    },
    getSelectedPaths: () => modelRef.current.getSelectedPaths(),
    replaceSelectedPaths: (paths) => {
      modelRef.current.replaceSelectedPaths(paths);
    },
    selectOnlyPath: (path) => {
      modelRef.current.selectOnlyPath(path);
    },
    selectPathRange: (path, unionSelection) => {
      modelRef.current.selectPathRange(path, unionSelection);
    },
    togglePathSelectionFromInput: (path) => {
      modelRef.current.togglePathSelectionFromInput(path);
    },
  };
}

export function applyFileTreeRowSelection(
  model: FileTreeSelectionModel,
  path: string,
  modifiers: FileTreeSelectionModifiers
): void {
  const additive = modifiers.ctrlKey || modifiers.metaKey;
  if (modifiers.shiftKey) {
    model.selectPathRange(path, additive);
  } else if (additive) {
    model.togglePathSelectionFromInput(path);
  } else {
    model.selectOnlyPath(path);
  }
  model.focusPath(path);
}

export function selectionSetsEqual(
  left: readonly string[],
  right: readonly string[]
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const rightSet = new Set(right);
  return left.every((path) => rightSet.has(path));
}

export function isFileTreeEditingKeyEvent(event: KeyboardEvent): boolean {
  if (event.defaultPrevented) {
    return true;
  }
  return eventComposedThroughEditingTarget(event);
}

export function eventComposedThroughEditingTarget(event: Event): boolean {
  for (const node of event.composedPath()) {
    if (
      node instanceof HTMLInputElement ||
      node instanceof HTMLTextAreaElement
    ) {
      return true;
    }
    if (node instanceof HTMLElement && node.isContentEditable) {
      return true;
    }
  }
  return false;
}

export function collapseFileTreeMultiSelectOnEscape(
  event: KeyboardEvent,
  model: FileTreeHostKeyModel,
  options?: { readonly searchOpen?: boolean }
): void {
  if (event.key !== "Escape" || event.defaultPrevented) {
    return;
  }
  if (isFileTreeEditingKeyEvent(event)) {
    return;
  }
  if (options?.searchOpen === true || model.isSearchOpen()) {
    return;
  }
  if (model.getSelectedPaths().length <= 1) {
    return;
  }
  const focused = model.getFocusedPath();
  if (focused == null) {
    return;
  }
  event.preventDefault();
  model.selectOnlyPath(focused);
}

export function handleFileTreeHostKeyDown(
  event: KeyboardEvent,
  model: FileTreeHostKeyModel,
  options: {
    readonly itemsByPath: ReadonlyMap<
      string,
      { readonly kind: string; readonly path: string }
    >;
    readonly onOpenPath?: ((path: string) => void) | undefined;
    readonly searchOpen?: boolean;
    readonly suppressOpen?: boolean;
  }
): void {
  if (event.key === "Escape") {
    collapseFileTreeMultiSelectOnEscape(event, model, options);
    return;
  }
  if (event.key !== "Enter" || event.repeat || options.suppressOpen === true) {
    return;
  }
  if (isFileTreeEditingKeyEvent(event)) {
    return;
  }
  const focused = model.getFocusedPath();
  if (focused == null) {
    return;
  }
  if (!model.getSelectedPaths().includes(focused)) {
    model.selectOnlyPath(focused);
    model.focusPath(focused);
  }
  const item = options.itemsByPath.get(focused);
  if (item?.kind === "file") {
    event.preventDefault();
    options.onOpenPath?.(item.path);
    return;
  }
  if (item?.kind !== "directory") {
    return;
  }
  const handle = model.getItem(focused);
  if (!isDirectoryHandle(handle)) {
    return;
  }
  event.preventDefault();
  if (handle.isExpanded()) {
    handle.collapse();
  } else {
    handle.expand();
  }
}
