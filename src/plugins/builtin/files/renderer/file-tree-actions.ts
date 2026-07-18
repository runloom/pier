import type {
  RendererPluginAction,
  RendererPluginActionInvocation,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import {
  FILES_COPY_PATH_COMMAND_ID,
  FILES_COPY_PATH_WITH_RANGE_COMMAND_ID,
  FILES_COPY_RELATIVE_PATH_COMMAND_ID,
  FILES_NEW_FILE_COMMAND_ID,
  FILES_NEW_FOLDER_COMMAND_ID,
  FILES_RENAME_COMMAND_ID,
  FILES_REVEAL_COMMAND_ID,
} from "../manifest.ts";
import type { FileEditorController } from "./file-editor-controller.ts";
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
  resolveCreateParentDir,
  validateName,
  writeClipboardText,
} from "./file-tree-action-utils.ts";
import { createDuplicateAction } from "./file-tree-actions-duplicate.ts";
import { createDeleteAction } from "./file-tree-delete-action.ts";
import { filePanelProjectRoot } from "./file-tree-preferences.ts";
import { createFilesTranslate, type FilesTranslate } from "./files-i18n.ts";
import { beginInlineCreate, createViaPrompt } from "./files-tree-create.ts";
import {
  findFilesTreeInstanceId,
  startFilesTreeInlineRename,
} from "./files-tree-registry.ts";
import { moveFilesTreeEntry } from "./files-tree-store.ts";
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
  t: FilesTranslate,
  controller: FileEditorController
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
        await controller.movePath(target.root, target.path, newPath);
        moveFilesTreeEntry(target.root, target.path, newPath);
        const moveDocument = async (root: string, from: string, to: string) =>
          await controller.movePath(root, from, to);
        notifyMoveWithUndo(
          context,
          t,
          target.root,
          target.path,
          newPath,
          moveDocument
        );
      } catch (error) {
        await context.dialogs.alert({
          body: error instanceof Error ? error.message : String(error),
          size: "default",
          title: t("filePanel.tree.renameFailed", "Unable to rename"),
        });
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
        await context.dialogs.alert({
          body: error instanceof Error ? error.message : String(error),
          size: "default",
          title: t("filePanel.tree.copyFailed", "Copy failed"),
        });
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
      t(
        "filePanel.editor.action.copyPathWithRange",
        "Copy Path and Selected Lines"
      ),
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
        await context.dialogs.alert({
          body: error instanceof Error ? error.message : String(error),
          size: "default",
          title: t("filePanel.tree.copyFailed", "Copy failed"),
        });
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
        await context.dialogs.alert({
          body: error instanceof Error ? error.message : String(error),
          size: "default",
          title: t("filePanel.tree.revealFailed", "Unable to reveal item"),
        });
      }
    },
  });
}

export function createFilesTreeActions(
  context: RendererPluginContext,
  controller: FileEditorController
): RendererPluginAction[] {
  const t = createFilesTranslate(context);
  return [
    createNewChildAction("file", FILES_NEW_FILE_COMMAND_ID, context, t),
    createNewChildAction("folder", FILES_NEW_FOLDER_COMMAND_ID, context, t),
    createRenameAction(context, t, controller),
    createDuplicateAction(context, t),
    createDeleteAction(context, t, controller),
    createCopyPathAction(context, t, "absolute"),
    createCopyPathAction(context, t, "relative"),
    createCopyPathWithRangeAction(context, t),
    createRevealAction(context, t),
  ];
}
