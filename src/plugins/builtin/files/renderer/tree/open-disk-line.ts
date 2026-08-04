import { onFilesDiskPathOpened } from "@plugins/api/files-disk-path-opened.ts";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { FileEditorController } from "../editor/controller.ts";
import { createFileEditorSessionId } from "../editor/session-id.ts";

/**
 * After host `openInEditor` / `openFilesDiskPath` with a line, reveal that
 * line in the files source editor (queued until the document loads).
 * Hard rejections (`goToLineResult === "rejected"`) surface a toast; applied
 * and queued outcomes stay silent.
 */
export function registerFilesDiskOpenLineReveal(
  controller: FileEditorController,
  context: RendererPluginContext
): () => void {
  return onFilesDiskPathOpened((event) => {
    if (event.line == null || event.line < 1) {
      return;
    }
    const source = {
      kind: "disk" as const,
      path: event.path,
      root: event.root,
    };
    controller.showSourceMode(event.instanceId);
    const result = controller.goToLineResult(
      createFileEditorSessionId(event.instanceId),
      controller.documentId(source),
      event.line,
      event.column
    );
    if (result === "rejected") {
      context.notifications.error(
        context.i18n.t(
          "filePanel.editor.goToLine.failed",
          undefined,
          "Unable to jump to that line."
        )
      );
    }
  });
}
