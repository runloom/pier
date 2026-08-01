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
} from "../../manifest.ts";
import type { FileEditorController } from "../editor/controller.ts";
import { createFilesTranslate, type FilesTranslate } from "../i18n.ts";
import { showFilesNamePrompt } from "../panel/name-prompt.tsx";
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
} from "./action-utils.ts";
import {
  createFileClipboardCopyAction,
  createFileClipboardCutAction,
  createFileClipboardPasteAction,
} from "./actions-clipboard.ts";
import { createDuplicateAction } from "./actions-duplicate.ts";
import { beginInlineCreate, createViaPrompt } from "./create.ts";
import { createDeleteAction } from "./delete-action.ts";
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
  // 无树调用上下文时，落到当前活动 files 树根（如未来快捷键路径）。
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
    // 仅树右键 / 空白处；不进命令面板（文件类仅保留转到文件 / 打开目录）。
    surfaces: ["files/tree-item", "files/tree-background"],
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
      group: "6_path",
      sortOrder: variant === "absolute" ? 1 : 2,
    },
    surfaces: ["files/tree-item", "files/editor", "files/markdown-preview"],
    title: () =>
      variant === "absolute"
        ? t("filePanel.tree.action.copyPath", "Copy Path")
        : t("filePanel.tree.action.copyRelativePath", "Copy Relative Path"),
    handler: async (invocation) => {
      const treeTarget = parseTreeMetadata(invocation);
      if (treeTarget) {
        const paths =
          treeTarget.selectedPaths &&
          treeTarget.selectedPaths.length > 1 &&
          treeTarget.selectedPaths.includes(treeTarget.path)
            ? treeTarget.selectedPaths
            : [treeTarget.path];
        const value = paths
          .map((path) =>
            variant === "absolute"
              ? joinAbsolutePath(treeTarget.root, path)
              : relativeToProjectRoot(
                  treeTarget.root,
                  path,
                  treeTarget.projectRoot
                )
          )
          .join("\n");
        try {
          await writeClipboardText(value);
          context.notifications.success(
            t("filePanel.tree.pathCopied", "Path copied")
          );
        } catch (error) {
          await context.dialogs.alert({
            body: error instanceof Error ? error.message : String(error),
            title: t("filePanel.tree.copyFailed", "Copy failed"),
          });
        }
        return;
      }
      const editorTarget = parseEditorMetadata(invocation);
      // Markdown preview 等 disk 源同样携带 path/root（可选 projectRoot）。
      const diskTarget =
        editorTarget ??
        (() => {
          const path =
            typeof invocation?.metadata?.path === "string"
              ? invocation.metadata.path
              : null;
          const root =
            typeof invocation?.metadata?.root === "string"
              ? invocation.metadata.root
              : null;
          if (!(path && root)) {
            return null;
          }
          const projectRoot =
            typeof invocation?.metadata?.projectRoot === "string"
              ? invocation.metadata.projectRoot
              : undefined;
          return { path, projectRoot, root };
        })();
      if (!diskTarget) {
        return;
      }
      const value =
        variant === "absolute"
          ? joinAbsolutePath(diskTarget.root, diskTarget.path)
          : relativeToProjectRoot(
              diskTarget.root,
              diskTarget.path,
              diskTarget.projectRoot
            );
      try {
        await writeClipboardText(value);
        context.notifications.success(
          t("filePanel.tree.pathCopied", "Path copied")
        );
      } catch (error) {
        await context.dialogs.alert({
          body: error instanceof Error ? error.message : String(error),
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
    metadata: { group: "6_path", sortOrder: 3 },
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
    metadata: { group: "6_path", sortOrder: 4 },
    surfaces: ["files/tree-item", "files/editor", "files/markdown-preview"],
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
    createNewChildAction("file", FILES_NEW_FILE_COMMAND_ID, context, t),
    createNewChildAction("folder", FILES_NEW_FOLDER_COMMAND_ID, context, t),
    createRenameAction(context, t, controller),
    createDuplicateAction(context, t),
    createFileClipboardCutAction(context, t),
    createFileClipboardCopyAction(context, t),
    createFileClipboardPasteAction(context, t),
    createDeleteAction(context, t, controller),
    createCopyPathAction(context, t, "absolute"),
    createCopyPathAction(context, t, "relative"),
    createCopyPathWithRangeAction(context, t),
    createRevealAction(context, t),
  ];
}
