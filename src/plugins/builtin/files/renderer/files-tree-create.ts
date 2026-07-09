import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { FILES_FILE_PANEL_ID } from "../manifest.ts";
import { createFileFilePanelInstanceId } from "./file-panel-id.ts";
import {
  basename,
  dirnameRelative,
  validateName,
  validateRelativePath,
} from "./file-tree-action-utils.ts";
import type { FilesDocumentPanelSource } from "./files-document-types.ts";
import { createFilesTranslate } from "./files-i18n.ts";
import {
  type FilesPendingCreateKind,
  findFilesTreeInstanceId,
  registerPendingCreate,
  removeFilesTreeModelPaths,
  revealFilesTreePath,
  startFilesTreeInlineRename,
  takePendingCreate,
} from "./files-tree-registry.ts";
import {
  addFilesTreeEntry,
  ensureAncestorDirectoryEntries,
  getFilesTreeSnapshot,
  loadFilesTreeDirectory,
  moveFilesTreeEntry,
  reloadFilesTreeRoot,
  removeFilesTreeEntry,
} from "./files-tree-store.ts";
import { showFilesNamePrompt } from "./name-prompt.tsx";

export type FilesCreateKind = FilesPendingCreateKind;

function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
      return;
    }
    queueMicrotask(() => resolve());
  });
}

function joinRelative(parentDir: string, name: string): string {
  return parentDir.length > 0 ? `${parentDir}/${name}` : name;
}

function defaultBaseName(kind: FilesCreateKind): string {
  return kind === "file" ? "untitled.ts" : "New Folder";
}

function nextCandidateName(base: string, attempt: number): string {
  if (attempt <= 1) {
    return base;
  }
  const dot = base.lastIndexOf(".");
  if (dot > 0 && kindLooksLikeFileBase(base)) {
    return `${base.slice(0, dot)} ${attempt}${base.slice(dot)}`;
  }
  return `${base} ${attempt}`;
}

function kindLooksLikeFileBase(base: string): boolean {
  const dot = base.lastIndexOf(".");
  return dot > 0 && !base.includes("/");
}

export async function allocateUniqueChildName(
  root: string,
  parentDir: string,
  base: string,
  exists: RendererPluginContext["files"]["exists"]
): Promise<string> {
  for (let attempt = 1; attempt <= 50; attempt += 1) {
    const name = nextCandidateName(base, attempt);
    const path = joinRelative(parentDir, name);
    const result = await exists({ path, root });
    if (!result.exists) {
      return name;
    }
  }
  return nextCandidateName(base, Date.now());
}

async function ensureParentDirectoryReady(
  context: RendererPluginContext,
  root: string,
  parentDir: string
): Promise<void> {
  if (parentDir.length === 0) {
    return;
  }
  const snapshot = getFilesTreeSnapshot(root);
  const state = snapshot.directoryStatesByPath.get(parentDir);
  if (state === "loaded" || state === "empty") {
    return;
  }
  await loadFilesTreeDirectory(root, parentDir, context.files.list);
}

function openCreatedDiskFile(
  context: RendererPluginContext,
  root: string,
  path: string,
  treeId: string | undefined
): void {
  const name = basename(path);
  const source: FilesDocumentPanelSource = { kind: "disk", path, root };
  const panelContext = context.panels.getActiveContext();
  context.panels.openInstance({
    componentId: FILES_FILE_PANEL_ID,
    ...(panelContext ? { context: panelContext } : {}),
    dropUnpinnedInstances: false,
    instanceId: createFileFilePanelInstanceId(source),
    params: {
      pinned: true,
      source,
    },
    ...(treeId ? { targetGroupId: treeId } : {}),
    title: name,
  });
}

/**
 * 库可能已乐观 move 到 to。失败时:
 * - 清掉占位 from;
 * - 仅当 to 原先不在 store(纯幽灵)时才删 to,避免误删已存在文件节点;
 * - 再 reload 根目录愈合模型/store 漂移。
 */
function discardCreateAttempt(options: {
  context: RendererPluginContext;
  destinationAlreadyInStore: boolean;
  from: string;
  root: string;
  to: string;
  treeId?: string | undefined;
}): void {
  const { context, destinationAlreadyInStore, from, root, to, treeId } =
    options;
  removeFilesTreeEntry(root, from);
  if (to !== from && !destinationAlreadyInStore) {
    removeFilesTreeEntry(root, to);
  }
  removeFilesTreeModelPaths({
    ...(treeId ? { instanceId: treeId } : {}),
    paths: to === from || destinationAlreadyInStore ? [from] : [from, to],
    root,
  });
  const t = createFilesTranslate(context);
  reloadFilesTreeRoot(
    root,
    context.files.list,
    t("panel.loadError.fallback", "Failed to load files")
  );
}

export async function commitCreatedPath(options: {
  context: RendererPluginContext;
  kind: FilesCreateKind;
  openAfter: boolean;
  path: string;
  root: string;
  treeId?: string | undefined;
}): Promise<boolean> {
  const { context, kind, openAfter, path, root, treeId } = options;
  const t = createFilesTranslate(context);
  try {
    if (kind === "file") {
      await context.files.writeText({ contents: "", path, root });
    } else {
      await context.files.mkdir({ path, root });
    }
  } catch (error) {
    context.notifications.error(
      error instanceof Error
        ? error.message
        : t("filePanel.tree.createFailed", "Unable to create item")
    );
    return false;
  }

  ensureAncestorDirectoryEntries(root, path);
  if (!getFilesTreeSnapshot(root).entriesByPath.has(path)) {
    addFilesTreeEntry(root, {
      kind: kind === "file" ? "file" : "directory",
      path,
      root,
    });
  }

  if (kind === "file" && openAfter) {
    openCreatedDiskFile(context, root, path, treeId);
  }
  revealFilesTreePath({
    ...(treeId ? { instanceId: treeId } : {}),
    path,
    root,
  });
  return true;
}

export async function commitInlineCreate(options: {
  context: RendererPluginContext;
  from: string;
  root: string;
  to: string;
}): Promise<boolean> {
  const pending = takePendingCreate(options.root, options.from);
  if (!pending) {
    return false;
  }
  const destinationAlreadyInStore =
    options.to !== options.from &&
    getFilesTreeSnapshot(options.root).entriesByPath.has(options.to);
  const t = createFilesTranslate(options.context);
  const leaf = basename(options.to);
  const invalid = validateName(leaf, t);
  if (invalid) {
    options.context.notifications.error(invalid);
    discardCreateAttempt({
      context: options.context,
      destinationAlreadyInStore,
      from: options.from,
      root: options.root,
      to: options.to,
      ...(pending.treeId ? { treeId: pending.treeId } : {}),
    });
    return true;
  }

  const { exists } = await options.context.files.exists({
    path: options.to,
    root: options.root,
  });
  // 同名确认时磁盘尚无该文件;改名到已存在路径才算冲突。
  if (exists && options.to !== options.from) {
    options.context.notifications.error(
      t("filePanel.tree.nameConflict", "Name already exists")
    );
    discardCreateAttempt({
      context: options.context,
      destinationAlreadyInStore,
      from: options.from,
      root: options.root,
      to: options.to,
      ...(pending.treeId ? { treeId: pending.treeId } : {}),
    });
    return true;
  }

  try {
    if (pending.kind === "file") {
      await options.context.files.writeText({
        contents: "",
        path: options.to,
        root: options.root,
      });
    } else {
      await options.context.files.mkdir({
        path: options.to,
        root: options.root,
      });
    }
  } catch (error) {
    options.context.notifications.error(
      error instanceof Error
        ? error.message
        : t("filePanel.tree.createFailed", "Unable to create item")
    );
    discardCreateAttempt({
      context: options.context,
      destinationAlreadyInStore,
      from: options.from,
      root: options.root,
      to: options.to,
      ...(pending.treeId ? { treeId: pending.treeId } : {}),
    });
    return true;
  }

  if (options.from !== options.to) {
    // 库模型已乐观 move;store 仍可能停在 from。
    if (getFilesTreeSnapshot(options.root).entriesByPath.has(options.from)) {
      moveFilesTreeEntry(options.root, options.from, options.to);
    } else if (
      !getFilesTreeSnapshot(options.root).entriesByPath.has(options.to)
    ) {
      addFilesTreeEntry(options.root, {
        kind: pending.kind === "file" ? "file" : "directory",
        path: options.to,
        root: options.root,
      });
    }
  } else if (pending.kind === "folder") {
    addFilesTreeEntry(options.root, {
      kind: "directory",
      path: options.to,
      root: options.root,
    });
  }

  if (pending.kind === "file" && pending.openAfter) {
    openCreatedDiskFile(
      options.context,
      options.root,
      options.to,
      pending.treeId
    );
  }
  revealFilesTreePath({
    ...(pending.treeId ? { instanceId: pending.treeId } : {}),
    path: options.to,
    root: options.root,
  });
  return true;
}

export function cancelInlineCreate(root: string, path: string): void {
  takePendingCreate(root, path);
  removeFilesTreeEntry(root, path);
}

export async function beginInlineCreate(options: {
  context: RendererPluginContext;
  kind: FilesCreateKind;
  parentDir: string;
  root: string;
  treeId?: string | undefined;
}): Promise<boolean> {
  const { context, kind, parentDir, root } = options;
  const treeId = options.treeId ?? findFilesTreeInstanceId(root) ?? undefined;
  await ensureParentDirectoryReady(context, root, parentDir);

  const name = await allocateUniqueChildName(
    root,
    parentDir,
    defaultBaseName(kind),
    context.files.exists
  );
  const placeholderPath = joinRelative(parentDir, name);
  addFilesTreeEntry(root, {
    kind: kind === "file" ? "file" : "directory",
    path: placeholderPath,
    root,
  });
  registerPendingCreate({
    kind,
    openAfter: kind === "file",
    placeholderPath,
    root,
    ...(treeId ? { treeId } : {}),
  });
  revealFilesTreePath({
    ...(treeId ? { instanceId: treeId } : {}),
    path: placeholderPath,
    root,
  });

  await waitForPaint();

  const started = startFilesTreeInlineRename({
    ...(treeId ? { instanceId: treeId } : {}),
    path: placeholderPath,
    removeIfCanceled: true,
    root,
  });
  if (!started) {
    takePendingCreate(root, placeholderPath);
    removeFilesTreeEntry(root, placeholderPath);
    return false;
  }
  return true;
}

export async function createViaPrompt(options: {
  allowNestedPath: boolean;
  context: RendererPluginContext;
  kind: FilesCreateKind;
  parentDir: string;
  root: string;
  treeId?: string | undefined;
}): Promise<void> {
  const { allowNestedPath, context, kind, parentDir, root, treeId } = options;
  const t = createFilesTranslate(context);
  const outcome = await showFilesNamePrompt(context, {
    title:
      kind === "file"
        ? t("filePanel.tree.action.newFile", "New File...")
        : t("filePanel.tree.action.newFolder", "New Folder..."),
    placeholder:
      kind === "file"
        ? t("filePanel.tree.placeholder.newFile", "example.ts")
        : t("filePanel.tree.placeholder.newFolder", "components"),
    initialValue: defaultBaseName(kind),
    validate: async (value) => {
      const trimmed = value.trim();
      if (allowNestedPath && trimmed.includes("/")) {
        const pathInvalid = validateRelativePath(trimmed, t);
        if (pathInvalid) {
          return pathInvalid;
        }
        const targetPath = joinRelative(parentDir, trimmed);
        const { exists } = await context.files.exists({
          path: targetPath,
          root,
        });
        return exists
          ? t("filePanel.tree.nameConflict", "Name already exists")
          : null;
      }
      const invalid = validateName(trimmed, t);
      if (invalid) {
        return invalid;
      }
      const targetPath = joinRelative(parentDir, trimmed);
      const { exists } = await context.files.exists({
        path: targetPath,
        root,
      });
      return exists
        ? t("filePanel.tree.nameConflict", "Name already exists")
        : null;
    },
  });
  if (outcome.cancelled) {
    return;
  }
  const relative = outcome.value.trim();
  const targetPath = joinRelative(parentDir, relative);
  await commitCreatedPath({
    context,
    kind,
    openAfter: kind === "file",
    path: targetPath,
    root,
    ...(treeId ? { treeId } : {}),
  });
}

export function resolveCreateParentDir(options: {
  kind?: "directory" | "file";
  path?: string;
}): string {
  if (!options.path) {
    return "";
  }
  if (options.kind === "directory") {
    return options.path;
  }
  return dirnameRelative(options.path);
}
