import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { FILES_FILE_PANEL_ID } from "../manifest.ts";
import { panelSourceForDocument } from "./file-panel-source.ts";
import {
  flushFilesDraftWrites,
  removePersistedDiskDraft,
} from "./files-document-drafts.ts";
import {
  preserveDiskDocumentAsUntitled,
  rollbackPreservedDiskDocument,
} from "./files-document-store.ts";
import {
  type FilesDocument,
  parseFilesDocumentPanelSource,
  sameFilesDocumentPanelSource,
} from "./files-document-types.ts";

export async function preserveDocumentsAsUntitledAndRebind(input: {
  context: RendererPluginContext;
  documents: readonly FilesDocument[];
}): Promise<FilesDocument[]> {
  const diskDocuments = input.documents.filter(
    (document) => document.source.kind === "disk"
  );
  const instances = input.context.panels.listInstances(FILES_FILE_PANEL_ID);
  const instanceIdsByDocumentId = new Map<string, string[]>();
  for (const document of diskDocuments) {
    if (document.source.kind !== "disk") continue;
    const ids = instances.flatMap((instance) => {
      const source = parseFilesDocumentPanelSource(instance.params);
      return sameFilesDocumentPanelSource(
        source,
        panelSourceForDocument(document)
      )
        ? [instance.id]
        : [];
    });
    if (ids.length === 0) {
      throw new Error(
        `Unable to persist the protected panel: ${document.source.path}`
      );
    }
    instanceIdsByDocumentId.set(document.id, ids);
  }

  const bindings: Array<{
    original: FilesDocument;
    preserved: FilesDocument;
  }> = [];
  const updatedPanels: Array<{ instanceId: string; source: unknown }> = [];
  try {
    for (const document of diskDocuments) {
      bindings.push({
        original: document,
        preserved: await preserveDiskDocumentAsUntitled(document.id),
      });
    }
    for (const binding of bindings) {
      const nextSource = panelSourceForDocument(binding.preserved);
      for (const instanceId of instanceIdsByDocumentId.get(
        binding.original.id
      ) ?? []) {
        if (
          !(
            nextSource &&
            input.context.panels.updateInstanceParams(
              FILES_FILE_PANEL_ID,
              instanceId,
              { source: nextSource }
            )
          )
        ) {
          throw new Error(
            `Unable to persist the protected panel: ${binding.original.name}`
          );
        }
        updatedPanels.push({
          instanceId,
          source: binding.original.source,
        });
      }
    }
    await input.context.panels.flushLayout();
  } catch (error) {
    for (const panel of updatedPanels) {
      input.context.panels.updateInstanceParams(
        FILES_FILE_PANEL_ID,
        panel.instanceId,
        { source: panel.source }
      );
    }
    let layoutRolledBack = updatedPanels.length === 0;
    if (updatedPanels.length > 0) {
      try {
        await input.context.panels.flushLayout();
        layoutRolledBack = true;
      } catch {
        // 两份草稿都保留；任一布局版本在重启后都有可恢复内容。
      }
    }
    for (const binding of bindings.reverse()) {
      rollbackPreservedDiskDocument({
        ...binding,
        removeUntitledDraft: layoutRolledBack,
      });
    }
    try {
      await flushFilesDraftWrites();
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "Unable to preserve files and fully persist the rollback"
      );
    }
    throw error;
  }
  for (const { original } of bindings) {
    if (original.source.kind === "disk") {
      removePersistedDiskDraft(original.id, {
        path: original.source.path,
        root: original.source.root,
      });
    }
  }
  await flushFilesDraftWrites();
  return bindings.map(({ preserved }) => preserved);
}
