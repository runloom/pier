import { getDocument } from "./files-document-store.ts";
import type { FileViewMode } from "./files-document-types.ts";

export function showFileEditorDiffMode(input: {
  documentId: string;
  getPanelDocumentId: (panelId: string) => string | null;
  modeHandlers: Map<string, (mode: FileViewMode) => void>;
  pendingModes: Map<string, FileViewMode>;
  preferredPanelId?: string;
}): void {
  if (input.preferredPanelId) {
    const preferred = input.modeHandlers.get(input.preferredPanelId);
    if (preferred) {
      preferred("diff");
      return;
    }
    input.pendingModes.set(input.preferredPanelId, "diff");
    return;
  }
  for (const [panelId, handler] of input.modeHandlers) {
    if (
      getDocument(input.getPanelDocumentId(panelId) ?? "")?.id ===
      getDocument(input.documentId)?.id
    ) {
      handler("diff");
      return;
    }
  }
}
