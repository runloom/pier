import type {
  RendererPluginAction,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import { FILES_DELETE_COMMAND_ID } from "../manifest.ts";
import type { FileEditorController } from "./file-editor-controller.ts";
import {
  basename,
  parseTreeMetadata,
  pluginAction,
} from "./file-tree-action-utils.ts";
import { isSamePathOrDescendant } from "./files-document-paths.ts";
import type { FilesDocument } from "./files-document-types.ts";
import type { FilesTranslate } from "./files-i18n.ts";
import { removeFilesTreeEntry } from "./files-tree-store.ts";

function collapseDeletionPaths(paths: readonly string[]): string[] {
  const unique = [...new Set(paths)];
  return unique.filter(
    (path) =>
      !unique.some(
        (candidate) =>
          candidate !== path && isSamePathOrDescendant(path, candidate)
      )
  );
}

async function protectOpenDocumentsBeforeTrash(input: {
  context: RendererPluginContext;
  controller: FileEditorController;
  currentDocuments: () => FilesDocument[];
  t: FilesTranslate;
}): Promise<"cancel" | "discard" | "protected"> {
  const { context, controller, currentDocuments, t } = input;
  const protectedDocuments = currentDocuments().filter(
    (document) =>
      document.dirty || document.durabilityUnknown || document.needsSaveAs
  );
  if (protectedDocuments.length === 0) {
    return "protected";
  }
  const choice = await context.dialogs.choice({
    altLabel: t("filePanel.tree.delete.otherOptions", "Other options"),
    body: t(
      "filePanel.tree.delete.protectedBody",
      "Open files under this path have protected changes. Save them before deleting the path? Deleted items can be restored from the system Trash."
    ),
    cancelLabel: t("filePanel.tree.delete.cancelLabel", "Cancel"),
    confirmLabel: t("filePanel.tree.delete.saveAndTrash", "Save and Delete"),
    intent: "default",
    size: "default",
    title: t("filePanel.tree.delete.protectedTitle", "Unsaved changes"),
  });
  if (choice === "cancel") {
    return "cancel";
  }
  if (choice === "confirm") {
    for (const document of protectedDocuments) {
      const result = await controller.settleDocument(
        document.id,
        undefined,
        "failure"
      );
      if (result.outcome !== "saved") {
        return "cancel";
      }
    }
    const stillProtected = currentDocuments().some(
      (document) =>
        document.dirty || document.durabilityUnknown || document.needsSaveAs
    );
    return stillProtected ? "cancel" : "protected";
  }

  const fallback = await context.dialogs.choice({
    altLabel: t(
      "filePanel.tree.delete.discardAndTrash",
      "Discard Changes and Delete"
    ),
    body: t(
      "filePanel.tree.delete.preserveBody",
      "Keep the current buffers as protected untitled documents, or explicitly discard them. Deleted items can be restored from the system Trash."
    ),
    cancelLabel: t("filePanel.tree.delete.cancelLabel", "Cancel"),
    confirmLabel: t("filePanel.tree.delete.keepUntitled", "Keep as Untitled"),
    intent: "destructive",
    size: "default",
    title: t("filePanel.tree.delete.otherOptions", "Other options"),
  });
  if (fallback === "cancel") {
    return "cancel";
  }
  if (fallback !== "confirm") {
    return "discard";
  }
  await controller.preserveDocumentsAsUntitled(protectedDocuments);
  return "discard";
}

export function createDeleteAction(
  context: RendererPluginContext,
  t: FilesTranslate,
  controller: FileEditorController
): RendererPluginAction {
  return pluginAction({
    id: FILES_DELETE_COMMAND_ID,
    category: "file",
    metadata: { group: "9_close", sortOrder: 1 },
    surfaces: ["files/tree-item"],
    title: () => t("filePanel.tree.action.delete", "Delete"),
    handler: async (invocation) => {
      const target = parseTreeMetadata(invocation);
      if (!target) {
        return;
      }
      const paths = collapseDeletionPaths(
        target.selectedPaths?.includes(target.path)
          ? target.selectedPaths
          : [target.path]
      );
      const displayName =
        paths.length === 1
          ? basename(paths[0] ?? target.path)
          : t("filePanel.tree.delete.multi", `${paths.length} items`, {
              count: paths.length,
            });
      const pathGuard = await controller.beginPathMutation(target.root, paths);
      const affectedDocuments = pathGuard.documents;
      const hadProtectedDocuments = affectedDocuments.some(
        (document) =>
          document.dirty || document.durabilityUnknown || document.needsSaveAs
      );
      try {
        try {
          const protection = await protectOpenDocumentsBeforeTrash({
            context,
            controller,
            currentDocuments: pathGuard.currentDocuments,
            t,
          });
          if (protection === "cancel") {
            return;
          }
          if (!hadProtectedDocuments) {
            const confirmed = await context.dialogs.confirm({
              body: t(
                "filePanel.tree.delete.body",
                `Delete "${displayName}"? You can restore it from the system Trash.`,
                { name: displayName }
              ),
              cancelLabel: t("filePanel.tree.delete.cancelLabel", "Cancel"),
              confirmLabel: t("filePanel.tree.delete.confirmLabel", "Delete"),
              intent: "destructive",
              size: "sm",
              title: t("filePanel.tree.delete.title", "Delete"),
            });
            if (!confirmed) {
              return;
            }
          }
        } catch (error) {
          await context.dialogs.alert({
            body: error instanceof Error ? error.message : String(error),
            size: "default",
            title: t(
              "filePanel.tree.delete.protectionFailed",
              "Unable to protect open files"
            ),
          });
          return;
        }
        const failures: Array<{ error: unknown; path: string }> = [];
        for (const path of paths) {
          try {
            await context.files.trash({ path, root: target.root });
            removeFilesTreeEntry(target.root, path);
            controller.removeDocumentsAfterPathMutation(
              pathGuard
                .currentDocuments()
                .filter(
                  (document) =>
                    document.source.kind === "disk" &&
                    document.source.root === target.root &&
                    isSamePathOrDescendant(document.source.path, path)
                )
            );
          } catch (error) {
            failures.push({ error, path });
          }
        }
        if (failures.length > 0) {
          await context.dialogs.alert({
            body: failures
              .map(
                ({ error, path }) =>
                  `${path}: ${error instanceof Error ? error.message : String(error)}`
              )
              .join("\n"),
            size: "default",
            title: t("filePanel.tree.deleteFailed", "Unable to delete"),
          });
        }
      } finally {
        pathGuard.release();
      }
    },
  });
}
