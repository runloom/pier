import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { FILES_FILE_PANEL_ID } from "../../manifest.ts";
import { recordCreatedDiskDocument } from "../document/store.ts";
import type { FilesDocumentPanelSource } from "../document/types.ts";
import { readFilesEditorDefaultEol } from "../editor/prefs.ts";
import { createFilesTranslate } from "../i18n.ts";
import { createFileFilePanelInstanceId } from "../panel/id.ts";
import { showFilesNamePrompt } from "../panel/name-prompt.tsx";
import {
  basename,
  validateName,
  validateRelativePath,
} from "./action-utils.ts";
import {
  allocateUniqueChildName,
  defaultFilesTreeBaseName,
  joinFilesTreeRelativePath,
  waitForFilesTreePaint,
} from "./create-name.ts";
import {
  type FilesPendingCreateKind,
  findFilesTreeInstanceId,
  registerPendingCreate,
  removeFilesTreeModelPaths,
  revealFilesTreePath,
  startFilesTreeInlineRename,
  takePendingCreate,
} from "./registry.ts";
import {
  addFilesTreeEntry,
  ensureAncestorDirectoryEntries,
  getFilesTreeSnapshot,
  loadFilesTreeDirectory,
  moveFilesTreeEntry,
  reloadFilesTreeRoot,
  removeFilesTreeEntry,
} from "./store.ts";
import { filesTreeVisibilityForContext } from "./visibility.ts";

export type FilesCreateKind = FilesPendingCreateKind;

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
  await loadFilesTreeDirectory(
    root,
    parentDir,
    filesTreeVisibilityForContext(context).list
  );
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
    filesTreeVisibilityForContext(context).list,
    t("panel.loadError.fallback", "Failed to load files")
  );
}

async function createEmptyFile(
  context: RendererPluginContext,
  root: string,
  path: string,
  preserveForOpen: boolean
): Promise<void> {
  const eol = readFilesEditorDefaultEol(context);
  const format = { bom: false, encoding: "utf8" } as const;
  const result = await context.files.writeDocument({
    contents: "",
    eol,
    expected: { kind: "absent" },
    format,
    path,
    root,
  });
  if (result.kind === "written") {
    let written = result;
    if (result.durability === "unknown") {
      const confirmation = await context.files.confirmDurability({
        expectedRevision: result.revision,
        path,
        root,
      });
      if (confirmation.kind === "confirmed") {
        written = {
          ...result,
          durability: "confirmed",
          revision: confirmation.revision,
        };
      } else {
        const t = createFilesTranslate(context);
        await context.dialogs.alert({
          body:
            confirmation.kind === "failed"
              ? confirmation.message
              : t(
                  "filePanel.tree.createDurabilityMismatch",
                  "The new file changed before its write could be confirmed."
                ),
          title: t(
            "filePanel.tree.createDurabilityUnknown",
            "File created, but durability is not confirmed"
          ),
        });
      }
    }
    if (preserveForOpen) {
      recordCreatedDiskDocument({
        eol,
        format,
        path,
        result: written,
        root,
      });
    }
    return;
  }
  throw new Error(
    result.kind === "not-writable"
      ? result.message
      : `File creation conflict: ${result.reason}`
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
      await createEmptyFile(context, root, path, openAfter);
    } else {
      await context.files.mkdir({ path, root });
    }
  } catch (error) {
    await context.dialogs.alert({
      body: error instanceof Error ? error.message : String(error),
      title: t("filePanel.tree.createFailed", "Unable to create item"),
    });
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

  try {
    const { exists } = await options.context.files.exists({
      path: options.to,
      root: options.root,
    });
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
    if (pending.kind === "file") {
      await createEmptyFile(
        options.context,
        options.root,
        options.to,
        pending.openAfter
      );
    } else {
      await options.context.files.mkdir({
        path: options.to,
        root: options.root,
      });
    }
  } catch (error) {
    await options.context.dialogs.alert({
      body: error instanceof Error ? error.message : String(error),
      title: t("filePanel.tree.createFailed", "Unable to create item"),
    });
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
    defaultFilesTreeBaseName(kind),
    context.files.exists
  );
  const placeholderPath = joinFilesTreeRelativePath(parentDir, name);
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

  await waitForFilesTreePaint();

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
    initialValue: defaultFilesTreeBaseName(kind),
    validate: async (value) => {
      const trimmed = value.trim();
      if (allowNestedPath && trimmed.includes("/")) {
        const pathInvalid = validateRelativePath(trimmed, t);
        if (pathInvalid) {
          return pathInvalid;
        }
        const targetPath = joinFilesTreeRelativePath(parentDir, trimmed);
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
      const targetPath = joinFilesTreeRelativePath(parentDir, trimmed);
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
  const targetPath = joinFilesTreeRelativePath(parentDir, relative);
  await commitCreatedPath({
    context,
    kind,
    openAfter: kind === "file",
    path: targetPath,
    root,
    ...(treeId ? { treeId } : {}),
  });
}
