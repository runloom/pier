import type {
  RendererPluginAction,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import { FILES_FILE_PANEL_ID, FILES_SAVE_ALL_COMMAND_ID } from "../manifest.ts";
import type { FileEditorController } from "./file-editor-controller.ts";
import { getDocument } from "./files-document-store.ts";
import { parseFilesDocumentPanelSource } from "./files-document-types.ts";

export function createSaveAllAction(
  context: RendererPluginContext,
  controller: FileEditorController
): RendererPluginAction {
  const t = (key: string, fallback?: string) =>
    context.i18n.t(key, undefined, fallback);
  return {
    category: "file",
    handler: async () => {
      const failedDocumentIds = new Set<string>();
      const maxPasses =
        context.panels.listInstances(FILES_FILE_PANEL_ID).length * 2 + 4;
      for (let pass = 0; pass < maxPasses; pass += 1) {
        const documents = new Map<
          string,
          { documentId: string; panelId: string }
        >();
        for (const instance of context.panels.listInstances(
          FILES_FILE_PANEL_ID
        )) {
          const source = parseFilesDocumentPanelSource(instance.params);
          if (!source) {
            continue;
          }
          const document = getDocument(controller.documentId(source));
          if (
            document &&
            !failedDocumentIds.has(document.id) &&
            (document.dirty ||
              document.needsSaveAs ||
              document.durabilityUnknown) &&
            !documents.has(document.id)
          ) {
            documents.set(document.id, {
              documentId: document.id,
              panelId: instance.id,
            });
          }
        }
        if (documents.size === 0) {
          break;
        }
        let progressed = false;
        for (const item of documents.values()) {
          const result = await controller.settleDocument(
            item.documentId,
            item.panelId,
            "none"
          );
          const latest = getDocument(result.documentId);
          if (
            (result.outcome === "saved" || result.outcome === "noop") &&
            latest &&
            !(latest.dirty || latest.needsSaveAs || latest.durabilityUnknown)
          ) {
            progressed = true;
          } else {
            failedDocumentIds.add(item.documentId);
          }
        }
        if (!progressed) {
          break;
        }
      }
      const failures = new Set<string>();
      for (const instance of context.panels.listInstances(
        FILES_FILE_PANEL_ID
      )) {
        const source = parseFilesDocumentPanelSource(instance.params);
        const document = source
          ? getDocument(controller.documentId(source))
          : null;
        if (
          document &&
          (document.dirty || document.needsSaveAs || document.durabilityUnknown)
        ) {
          failures.add(document.name);
        }
      }
      if (failures.size > 0) {
        await context.dialogs.alert({
          body: [...failures].join("\n"),
          title: t("filePanel.saveAll.failed", "Some files could not be saved"),
        });
      }
    },
    id: FILES_SAVE_ALL_COMMAND_ID,
    metadata: { group: "5_save", sortOrder: 3 },
    surfaces: ["command-palette"],
    title: () => t("filePanel.saveAll", "Save All"),
  };
}
