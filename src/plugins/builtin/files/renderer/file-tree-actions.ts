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
  FILES_REVEAL_COMMAND_ID,
  FILES_TREE_REFRESH_COMMAND_ID,
} from "../manifest.ts";
import {
  basename,
  dirnameRelative,
  joinAbsolutePath,
  notifyMoveWithUndo,
  parseEditorMetadata,
  parseTreeBackgroundMetadata,
  parseTreeMetadata,
  pluginAction,
  relativeToProjectRoot,
  validateName,
  writeClipboardText,
} from "./file-tree-action-utils.ts";
import { createDuplicateAction } from "./file-tree-actions-duplicate.ts";
import { filePanelProjectRoot } from "./file-tree-preferences.ts";
import {
  moveDiskDocumentSource,
  removeDiskDocumentForPath,
} from "./files-document-store.ts";
import { createFilesTranslate, type FilesTranslate } from "./files-i18n.ts";
import {
  beginInlineCreate,
  createViaPrompt,
  resolveCreateParentDir,
} from "./files-tree-create.ts";
import {
  findFilesTreeInstanceId,
  startFilesTreeInlineRename,
} from "./files-tree-registry.ts";
import {
  moveFilesTreeEntry,
  reloadFilesTreeRoot,
  removeFilesTreeEntry,
} from "./files-tree-store.ts";
import { showFilesNamePrompt } from "./name-prompt.tsx";

function resolveCreateTarget(
  context: RendererPluginContext,
  invocation: RendererPluginActionInvocation | undefined
): { parentDir: string; root: string; treeId?: string } | null {
  const treeItem = parseTreeMetadata(invocation);
  if (treeItem) {
    return {
      parentDir: resolveCreateParentDir({
        kind: treeItem.kind,
        path: treeItem.path,
      }),
      root: treeItem.root,
      ...(treeItem.treeId ? { treeId: treeItem.treeId } : {}),
    };
  }
  const background = parseTreeBackgroundMetadata(invocation);
  if (background) {
    return {
      parentDir: "",
      root: background.root,
      ...(background.treeId ? { treeId: background.treeId } : {}),
    };
  }
  // command-palette:落到当前活动 files 树根。
  const root = filePanelProjectRoot(context.panels.getActiveContext());
  if (!root) {
    return null;
  }
  const treeId = findFilesTreeInstanceId(root) ?? undefined;
  return {
    parentDir: "",
    root,
    ...(treeId ? { treeId } : {}),
  };
}

function createNewChildAction(
  kind: "file" | "folder",
  actionId: string,
  context: RendererPluginContext,
  t: FilesTranslate
): RendererPluginAction {
  return pluginAction({
    id: actionId,
    category: "file",
    metadata: {
      group: "1_new",
      sortOrder: kind === "file" ? 1 : 2,
    },
    surfaces: ["files/tree-item", "files/tree-background", "command-palette"],
    title: () =>
      kind === "file"
        ? t("filePanel.tree.action.newFile", "New File...")
        : t("filePanel.tree.action.newFolder", "New Folder..."),
    handler: async (invocation) => {
      const target = resolveCreateTarget(context, invocation);
      if (!target) {
        context.notifications.info(
          t(
            "filePanel.tree.createNeedsProject",
            "Open a project to create files."
          )
        );
        return;
      }
      // 命令面板走 prompt,支持 a/b/c.ts 嵌套路径;树内右键优先 inline。
      if (invocation?.surface === "command-palette") {
        await createViaPrompt({
          allowNestedPath: true,
          context,
          kind,
          parentDir: target.parentDir,
          root: target.root,
          ...(target.treeId ? { treeId: target.treeId } : {}),
        });
        return;
      }
      const started = await beginInlineCreate({
        context,
        kind,
        parentDir: target.parentDir,
        root: target.root,
        ...(target.treeId ? { treeId: target.treeId } : {}),
      });
      if (started) {
        return;
      }
      // 树 API 不可用(面板折叠等):弹窗回退;背景菜单允许嵌套路径。
      await createViaPrompt({
        allowNestedPath: invocation?.surface === "files/tree-background",
        context,
        kind,
        parentDir: target.parentDir,
        root: target.root,
        ...(target.treeId ? { treeId: target.treeId } : {}),
      });
    },
  });
}

function createRenameAction(
  context: RendererPluginContext,
  t: FilesTranslate
): RendererPluginAction {
  return pluginAction({
    id: FILES_RENAME_COMMAND_ID,
    category: "file",
    metadata: { group: "5_edit", sortOrder: 1 },
    surfaces: ["files/tree-item"],
    title: () => t("filePanel.tree.action.rename", "Rename..."),
    handler: async (invocation) => {
      const target = parseTreeMetadata(invocation);
      if (!target) {
        return;
      }
      // 优先树内 inline 输入(Cursor/VS Code 语义);树不可用(面板折叠等)
      // 退回宿主 prompt。inline 提交后 sidebar 的 onRenamePath 执行 move。
      if (
        startFilesTreeInlineRename({
          ...(target.treeId ? { instanceId: target.treeId } : {}),
          path: target.path,
          root: target.root,
        })
      ) {
        return;
      }
      const parentDir = dirnameRelative(target.path);
      const currentName = basename(target.path);
      const outcome = await showFilesNamePrompt(context, {
        title: t("filePanel.tree.action.rename", "Rename..."),
        initialValue: currentName,
        validate: async (name) => {
          if (name === currentName) {
            return null;
          }
          const invalid = validateName(name, t);
          if (invalid) {
            return invalid;
          }
          const newPath = parentDir.length > 0 ? `${parentDir}/${name}` : name;
          const { exists } = await context.files.exists({
            path: newPath,
            root: target.root,
          });
          return exists
            ? t("filePanel.tree.nameConflict", "Name already exists")
            : null;
        },
      });
      if (outcome.cancelled || outcome.value === currentName) {
        return;
      }
      const newPath =
        parentDir.length > 0 ? `${parentDir}/${outcome.value}` : outcome.value;
      try {
        await context.files.move({
          newPath,
          path: target.path,
          root: target.root,
        });
        moveFilesTreeEntry(target.root, target.path, newPath);
        moveDiskDocumentSource(target.root, target.path, newPath);
        notifyMoveWithUndo(context, t, target.root, target.path, newPath);
      } catch (error) {
        context.notifications.error(
          error instanceof Error
            ? error.message
            : t("filePanel.tree.renameFailed", "Unable to rename")
        );
      }
    },
  });
}

function createDeleteAction(
  context: RendererPluginContext,
  t: FilesTranslate
): RendererPluginAction {
  return pluginAction({
    id: FILES_DELETE_COMMAND_ID,
    category: "file",
    metadata: { group: "9_close", sortOrder: 1 },
    surfaces: ["files/tree-item"],
    title: () => t("filePanel.tree.action.delete", "Move to Trash"),
    handler: async (invocation) => {
      const target = parseTreeMetadata(invocation);
      if (!target) {
        return;
      }
      // 多选批量:右键目标在选中集内时一次确认、逐项进回收站。
      const paths = target.selectedPaths?.includes(target.path)
        ? target.selectedPaths
        : [target.path];
      const displayName =
        paths.length === 1
          ? basename(target.path)
          : t("filePanel.tree.delete.multi", `${paths.length} items`);
      const confirmed = await context.dialogs.confirm({
        title: t("filePanel.tree.delete.title", "Move to Trash"),
        body: t(
          "filePanel.tree.delete.body",
          `Move "${displayName}" to the system trash?`
        ),
        confirmLabel: t("filePanel.tree.delete.confirmLabel", "Move to Trash"),
        cancelLabel: t("filePanel.tree.delete.cancelLabel", "Cancel"),
        intent: "destructive",
        size: "sm",
      });
      if (!confirmed) {
        return;
      }
      for (const path of paths) {
        try {
          await context.files.trash({ path, root: target.root });
          removeFilesTreeEntry(target.root, path);
          removeDiskDocumentForPath(target.root, path);
        } catch (error) {
          context.notifications.error(
            error instanceof Error
              ? error.message
              : t("filePanel.tree.deleteFailed", "Unable to delete")
          );
        }
      }
    },
  });
}

function createCopyPathAction(
  context: RendererPluginContext,
  t: FilesTranslate,
  variant: "absolute" | "relative"
): RendererPluginAction {
  return pluginAction({
    id:
      variant === "absolute"
        ? FILES_COPY_PATH_COMMAND_ID
        : FILES_COPY_RELATIVE_PATH_COMMAND_ID,
    category: "file",
    metadata: {
      group: "6_copypath",
      sortOrder: variant === "absolute" ? 1 : 2,
    },
    surfaces: ["files/tree-item"],
    title: () =>
      variant === "absolute"
        ? t("filePanel.tree.action.copyPath", "Copy Path")
        : t("filePanel.tree.action.copyRelativePath", "Copy Relative Path"),
    handler: async (invocation) => {
      const target = parseTreeMetadata(invocation);
      if (!target) {
        return;
      }
      const value =
        variant === "absolute"
          ? joinAbsolutePath(target.root, target.path)
          : target.path;
      try {
        await writeClipboardText(value);
        context.notifications.success(
          t("filePanel.tree.pathCopied", "Path copied")
        );
      } catch (error) {
        context.notifications.error(
          error instanceof Error
            ? error.message
            : t("filePanel.tree.copyFailed", "Copy failed")
        );
      }
    },
  });
}

function createCopyPathWithRangeAction(
  context: RendererPluginContext,
  t: FilesTranslate
): RendererPluginAction {
  return pluginAction({
    id: FILES_COPY_PATH_WITH_RANGE_COMMAND_ID,
    category: "file",
    metadata: { group: "6_copypath", sortOrder: 3 },
    surfaces: ["files/editor"],
    title: () =>
      t("filePanel.editor.action.copyPathWithRange", "Copy Path with Range"),
    handler: async (invocation) => {
      const target = parseEditorMetadata(invocation);
      if (!target) {
        return;
      }
      // Cursor 风格:`src/foo.ts:42-58`;单行 `src/foo.ts:42`;无选区不带范围。
      const rel = relativeToProjectRoot(
        target.root,
        target.path,
        target.projectRoot
      );
      let suffix = "";
      const start = target.selectionStartLine;
      const end = target.selectionEndLine;
      if (start && end) {
        suffix = start === end ? `:${start}` : `:${start}-${end}`;
      } else if (start) {
        suffix = `:${start}`;
      }
      try {
        await writeClipboardText(`${rel}${suffix}`);
        context.notifications.success(
          t("filePanel.tree.pathCopied", "Path copied")
        );
      } catch (error) {
        context.notifications.error(
          error instanceof Error
            ? error.message
            : t("filePanel.tree.copyFailed", "Copy failed")
        );
      }
    },
  });
}

function createRevealAction(
  context: RendererPluginContext,
  t: FilesTranslate
): RendererPluginAction {
  return pluginAction({
    id: FILES_REVEAL_COMMAND_ID,
    category: "file",
    metadata: { group: "6_copypath", sortOrder: 4 },
    surfaces: ["files/tree-item"],
    title: () => t("filePanel.tree.action.reveal", "Reveal in Finder"),
    handler: async (invocation) => {
      const target = parseTreeMetadata(invocation);
      if (!target) {
        return;
      }
      try {
        await context.files.reveal({ path: target.path, root: target.root });
      } catch (error) {
        context.notifications.error(
          error instanceof Error
            ? error.message
            : t("filePanel.tree.revealFailed", "Unable to reveal item")
        );
      }
    },
  });
}

function createTreeRefreshAction(
  context: RendererPluginContext,
  t: FilesTranslate
): RendererPluginAction {
  return pluginAction({
    id: FILES_TREE_REFRESH_COMMAND_ID,
    category: "file",
    metadata: { group: "7_refresh", sortOrder: 1 },
    surfaces: ["files/tree-item"],
    title: () => t("panel.tree.refresh", "Refresh"),
    handler: async (invocation) => {
      const target = parseTreeMetadata(invocation);
      if (!target) {
        return;
      }
      reloadFilesTreeRoot(
        target.root,
        context.files.list,
        t("panel.loadError.fallback", "Failed to load files")
      );
      return await Promise.resolve();
    },
  });
}

export function createFilesTreeActions(
  context: RendererPluginContext
): RendererPluginAction[] {
  const t = createFilesTranslate(context);
  return [
    createNewChildAction("file", FILES_NEW_FILE_COMMAND_ID, context, t),
    createNewChildAction("folder", FILES_NEW_FOLDER_COMMAND_ID, context, t),
    createRenameAction(context, t),
    createDuplicateAction(context, t),
    createDeleteAction(context, t),
    createCopyPathAction(context, t, "absolute"),
    createCopyPathAction(context, t, "relative"),
    createCopyPathWithRangeAction(context, t),
    createRevealAction(context, t),
    createTreeRefreshAction(context, t),
  ];
}
