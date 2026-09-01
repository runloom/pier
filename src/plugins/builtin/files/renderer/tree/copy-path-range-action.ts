import type {
  RendererPluginAction,
  RendererPluginActionInvocation,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import {
  FILES_COPY_PATH_COMMAND_ID,
  FILES_COPY_PATH_WITH_RANGE_COMMAND_ID,
  FILES_COPY_RELATIVE_PATH_COMMAND_ID,
  FILES_FILE_PANEL_ID,
} from "../../manifest.ts";
import type { FileEditorController } from "../editor/controller.ts";
import { createFileEditorSessionId } from "../editor/session-id.ts";
import type { FilesTranslate } from "../i18n.ts";
import {
  type FilesEditorTargetMetadata,
  joinAbsolutePath,
  parseEditorMetadata,
  parseTreeMetadata,
  pluginAction,
  relativeToProjectRoot,
  writeClipboardText,
} from "./action-utils.ts";
import { filePanelProjectRoot } from "./preferences.ts";
import { getFilesTreeSelectedPaths } from "./registry.ts";

interface CopyPathTarget {
  paths: readonly string[];
  projectRoot?: string;
  root: string;
}

function selectionPaths(
  path: string,
  selectedPaths: readonly string[] | undefined
): readonly string[] {
  if (
    selectedPaths &&
    selectedPaths.length > 1 &&
    selectedPaths.includes(path)
  ) {
    return selectedPaths;
  }
  return [path];
}

function parseDiskMetadata(
  invocation: RendererPluginActionInvocation | undefined
): FilesEditorTargetMetadata | null {
  const fromEditor = parseEditorMetadata(invocation);
  if (fromEditor) {
    return fromEditor;
  }
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
  return { path, root, ...(projectRoot ? { projectRoot } : {}) };
}

function resolveCopyPathTarget(
  context: RendererPluginContext,
  controller: FileEditorController,
  invocation: RendererPluginActionInvocation | undefined
): CopyPathTarget | null {
  const treeTarget = parseTreeMetadata(invocation);
  if (treeTarget) {
    return {
      paths: selectionPaths(treeTarget.path, treeTarget.selectedPaths),
      root: treeTarget.root,
      ...(treeTarget.projectRoot
        ? { projectRoot: treeTarget.projectRoot }
        : {}),
    };
  }
  const diskTarget = parseDiskMetadata(invocation);
  if (diskTarget) {
    return {
      paths: [diskTarget.path],
      root: diskTarget.root,
      ...(diskTarget.projectRoot
        ? { projectRoot: diskTarget.projectRoot }
        : {}),
    };
  }
  const panelId =
    invocation?.sourcePanelId ??
    context.panels.getActiveInstanceId(FILES_FILE_PANEL_ID);
  if (panelId) {
    const source = controller.getPanelSource(panelId);
    if (source?.kind === "disk") {
      const projectRoot =
        invocation?.sourcePanelContext?.projectRootPath ??
        context.panels.getActiveContext()?.projectRootPath;
      return {
        paths: [source.path],
        root: source.root,
        ...(projectRoot ? { projectRoot } : {}),
      };
    }
  }
  const panelRoot = filePanelProjectRoot(
    invocation?.sourcePanelContext ?? context.panels.getActiveContext()
  );
  return getFilesTreeSelectedPaths({
    ...(panelId ? { instanceId: panelId } : {}),
    ...(panelRoot ? { root: panelRoot } : {}),
  });
}

function formatCopyPathValue(
  variant: "absolute" | "relative",
  target: CopyPathTarget
): string {
  return target.paths
    .map((path) =>
      variant === "absolute"
        ? joinAbsolutePath(target.root, path)
        : relativeToProjectRoot(target.root, path, target.projectRoot)
    )
    .join("\n");
}

async function copyPathValue(
  context: RendererPluginContext,
  t: FilesTranslate,
  value: string
): Promise<void> {
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
}

function resolveCopyPathWithRangeTarget(
  context: RendererPluginContext,
  controller: FileEditorController,
  invocation: RendererPluginActionInvocation | undefined
): FilesEditorTargetMetadata | null {
  const fromInvocation = parseEditorMetadata(invocation);
  if (fromInvocation) {
    return fromInvocation;
  }
  const panelId =
    invocation?.sourcePanelId ??
    context.panels.getActiveInstanceId(FILES_FILE_PANEL_ID);
  if (!panelId) {
    return null;
  }
  const source = controller.getPanelSource(panelId);
  if (source?.kind !== "disk") {
    return null;
  }
  const selection = controller.currentSelectionLinesForSession(
    createFileEditorSessionId(panelId)
  );
  const projectRoot =
    invocation?.sourcePanelContext?.projectRootPath ??
    context.panels.getActiveContext()?.projectRootPath;
  return {
    path: source.path,
    root: source.root,
    ...(projectRoot ? { projectRoot } : {}),
    ...(selection
      ? {
          selectionEndLine: selection.endLine,
          selectionStartLine: selection.startLine,
        }
      : {}),
  };
}

function formatPathWithRange(target: FilesEditorTargetMetadata): string {
  const rel = relativeToProjectRoot(
    target.root,
    target.path,
    target.projectRoot
  );
  const start = target.selectionStartLine;
  const end = target.selectionEndLine;
  if (start && end) {
    return start === end ? `${rel}:${start}` : `${rel}:${start}-${end}`;
  }
  if (start) {
    return `${rel}:${start}`;
  }
  return rel;
}

export function createCopyPathAction(
  context: RendererPluginContext,
  controller: FileEditorController,
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
    surfaces: ["files/tree-item", "files/breadcrumb", "command-palette"],
    title: () =>
      variant === "absolute"
        ? t("filePanel.tree.action.copyPath", "Copy Path")
        : t("filePanel.tree.action.copyRelativePath", "Copy Relative Path"),
    handler: async (invocation) => {
      const target = resolveCopyPathTarget(context, controller, invocation);
      if (!target) {
        context.notifications.info(
          t("filePanel.tree.noPathToCopy", "Open or select a file first.")
        );
        return;
      }
      await copyPathValue(context, t, formatCopyPathValue(variant, target));
    },
  });
}

export function createCopyPathWithRangeAction(
  context: RendererPluginContext,
  controller: FileEditorController,
  t: FilesTranslate
): RendererPluginAction {
  return pluginAction({
    id: FILES_COPY_PATH_WITH_RANGE_COMMAND_ID,
    category: "file",
    metadata: { group: "6_path", sortOrder: 3 },
    surfaces: ["files/editor", "command-palette"],
    title: () =>
      t(
        "filePanel.editor.action.copyPathWithRange",
        "Copy Path and Selected Lines"
      ),
    handler: async (invocation) => {
      const target = resolveCopyPathWithRangeTarget(
        context,
        controller,
        invocation
      );
      if (!target) {
        context.notifications.info(
          t("filePanel.tree.noPathToCopy", "Open or select a file first.")
        );
        return;
      }
      await copyPathValue(context, t, formatPathWithRange(target));
    },
  });
}
