import type {
  RendererPluginAction,
  RendererPluginActionInvocation,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import { FilePlus } from "lucide-react";
import {
  FILES_NEW_FILE_COMMAND_ID,
  FILES_NEW_FOLDER_COMMAND_ID,
  FILES_RENAME_COMMAND_ID,
  FILES_REVEAL_COMMAND_ID,
} from "../../manifest.ts";
import type { FileEditorController } from "../editor/controller.ts";
import { createFilesTranslate, type FilesTranslate } from "../i18n.ts";
import { showFilesNamePrompt } from "../panel/name-prompt.tsx";
import {
  basename,
  dirnameRelative,
  notifyMoveWithUndo,
  parseEditorMetadata,
  parseTreeBackgroundMetadata,
  parseTreeMetadata,
  pluginAction,
  resolveCreateParentDir,
  validateName,
} from "./action-utils.ts";
import {
  createFileClipboardCopyAction,
  createFileClipboardCutAction,
  createFileClipboardPasteAction,
} from "./actions-clipboard.ts";
import { createDuplicateAction } from "./actions-duplicate.ts";
import {
  createCopyPathAction,
  createCopyPathWithRangeAction,
} from "./copy-path-range-action.ts";
import { beginInlineCreate, createViaPrompt } from "./create.ts";
import { createDeleteAction } from "./delete-action.ts";
import { openUntitledFileFromCreateMenu } from "./open-untitled.ts";
import { filePanelProjectRoot } from "./preferences.ts";
import {
  findFilesTreeInstanceId,
  startFilesTreeInlineRename,
} from "./registry.ts";
import { moveFilesTreeEntry } from "./store.ts";

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
  // 无树调用上下文时（创建菜单 / 快捷键），用调用方 panel 或当前活动上下文。
  const root = filePanelProjectRoot(
    invocation?.sourcePanelContext ?? context.panels.getActiveContext()
  );
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

function createNeedsProjectReason(t: FilesTranslate): string {
  return t(
    "filePanel.tree.createNeedsProject",
    "Open a project to create files."
  );
}

function newFileActionTitle(
  t: FilesTranslate,
  invocation?: RendererPluginActionInvocation
): string {
  if (invocation?.surface === "create-menu") {
    return t("filePanel.createMenu.newFile", "New File");
  }
  return t("filePanel.tree.action.newFile", "New File...");
}

function createNewChildAction(
  kind: "file" | "folder",
  actionId: string,
  context: RendererPluginContext,
  t: FilesTranslate,
  controller?: FileEditorController
): RendererPluginAction {
  const isFile = kind === "file";
  return pluginAction({
    id: actionId,
    category: "file",
    metadata: {
      categoryKey: "file",
      group: "1_new",
      ...(isFile ? { iconComponent: FilePlus } : {}),
      sortOrder: isFile ? 1 : 2,
    },
    // 创建菜单：未命名标签，保存再落盘。树右键仍先起名再写盘。
    // 两者都不进命令面板（文件类仅保留转到文件 / 打开目录）。
    surfaces: isFile
      ? ["files/tree-item", "files/tree-background", "create-menu"]
      : ["files/tree-item", "files/tree-background"],
    title: (invocation) =>
      isFile
        ? newFileActionTitle(t, invocation)
        : t("filePanel.tree.action.newFolder", "New Folder..."),
    handler: async (invocation) => {
      // 无树选区（创建菜单 / 快捷键，含宿主漏带 surface）→ 未命名标签。
      if (
        isFile &&
        controller &&
        !parseTreeMetadata(invocation) &&
        !parseTreeBackgroundMetadata(invocation)
      ) {
        openUntitledFileFromCreateMenu(context, controller, invocation);
        return;
      }
      const target = resolveCreateTarget(context, invocation);
      if (!target) {
        context.notifications.info(createNeedsProjectReason(t));
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
    metadata: {
      group: "5_edit",
      // 多选不支持批量重命名。
      menuHidden: (invocation) => {
        const target = parseTreeMetadata(invocation);
        return Boolean(
          target?.selectedPaths &&
            target.selectedPaths.length > 1 &&
            target.selectedPaths.includes(target.path)
        );
      },
      sortOrder: 1,
    },
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
          title: t("filePanel.tree.renameFailed", "Unable to rename"),
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
    metadata: { group: "6_path", sortOrder: 4 },
    surfaces: [
      "files/tree-item",
      "files/editor",
      "files/markdown-preview",
      "files/canvas-preview",
    ],
    title: () => t("filePanel.tree.action.reveal", "Reveal in Finder"),
    handler: async (invocation) => {
      const treeTarget = parseTreeMetadata(invocation);
      const editorTarget = parseEditorMetadata(invocation);
      const path =
        treeTarget?.path ??
        editorTarget?.path ??
        (typeof invocation?.metadata?.path === "string"
          ? invocation.metadata.path
          : undefined);
      const root =
        treeTarget?.root ??
        editorTarget?.root ??
        (typeof invocation?.metadata?.root === "string"
          ? invocation.metadata.root
          : undefined);
      if (!(path && root)) {
        return;
      }
      try {
        await context.files.reveal({ path, root });
      } catch (error) {
        await context.dialogs.alert({
          body: error instanceof Error ? error.message : String(error),
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
    createNewChildAction(
      "file",
      FILES_NEW_FILE_COMMAND_ID,
      context,
      t,
      controller
    ),
    createNewChildAction("folder", FILES_NEW_FOLDER_COMMAND_ID, context, t),
    createRenameAction(context, t, controller),
    createDuplicateAction(context, t),
    createFileClipboardCutAction(context, t),
    createFileClipboardCopyAction(context, t),
    createFileClipboardPasteAction(context, t),
    createDeleteAction(context, t, controller),
    createCopyPathAction(context, controller, t, "absolute"),
    createCopyPathAction(context, controller, t, "relative"),
    createCopyPathWithRangeAction(context, controller, t),
    createRevealAction(context, t),
  ];
}
