import { fileTabIconId } from "@pier/ui/file-icon.tsx";
import type { PanelTabChrome } from "@shared/contracts/panel.ts";
import { parseFilesDocumentPanelSource } from "./files-document-types.ts";

export function filesPanelTabChrome(
  params: Readonly<Record<string, unknown>>
): PanelTabChrome | undefined {
  const source = parseFilesDocumentPanelSource(params);
  if (!source) {
    return;
  }
  return {
    icon: {
      id: fileTabIconId(source.kind === "disk" ? source.path : source.name),
    },
  };
}
