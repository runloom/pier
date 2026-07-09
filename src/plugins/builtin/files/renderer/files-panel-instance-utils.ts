import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { FILES_FILE_PANEL_ID } from "../manifest.ts";
import type { FilesDocumentPanelSource } from "./files-document-types.ts";
import {
  parseFilesDocumentPanelSource,
  sameFilesDocumentPanelSource,
} from "./files-document-types.ts";

export function hasOtherOpenFilesSourceInstance(input: {
  closingPanelIds?: readonly string[];
  context: RendererPluginContext | undefined;
  panelId: string | undefined;
  source: FilesDocumentPanelSource;
}): boolean {
  if (!input.context) {
    return false;
  }
  const closingPanelIds = new Set(input.closingPanelIds ?? []);
  return input.context.panels
    .listInstances(FILES_FILE_PANEL_ID)
    .some((instance) => {
      if (instance.id === input.panelId) {
        return false;
      }
      if (closingPanelIds.has(instance.id)) {
        return false;
      }
      return sameFilesDocumentPanelSource(
        parseFilesDocumentPanelSource(instance.params),
        input.source
      );
    });
}
