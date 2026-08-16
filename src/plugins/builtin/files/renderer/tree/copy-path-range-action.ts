import type {
  RendererPluginAction,
  RendererPluginActionInvocation,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import {
  FILES_COPY_PATH_WITH_RANGE_COMMAND_ID,
  FILES_FILE_PANEL_ID,
} from "../../manifest.ts";
import type { FileEditorController } from "../editor/controller.ts";
import { createFileEditorSessionId } from "../editor/session-id.ts";
import type { FilesTranslate } from "../i18n.ts";
import {
  type FilesEditorTargetMetadata,
  parseEditorMetadata,
  pluginAction,
  relativeToProjectRoot,
  writeClipboardText,
} from "./action-utils.ts";

function resolveCopyPathWithRangeTarget(
  context: RendererPluginContext,
  controller: FileEditorController,
  invocation: RendererPluginActionInvocation | undefined
): FilesEditorTargetMetadata | null {
  const fromInvocation = parseEditorMetadata(invocation);
  if (fromInvocation) {
    return fromInvocation;
  }
  const panelId = context.panels.getActiveInstanceId(FILES_FILE_PANEL_ID);
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
  const projectRoot = context.panels.getActiveContext()?.projectRootPath;
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

export function createCopyPathWithRangeAction(
  context: RendererPluginContext,
  controller: FileEditorController,
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
      const target = resolveCopyPathWithRangeTarget(
        context,
        controller,
        invocation
      );
      if (!target) {
        return;
      }
      try {
        await writeClipboardText(formatPathWithRange(target));
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
