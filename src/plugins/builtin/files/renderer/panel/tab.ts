import { fileTabIconId } from "@pier/ui/file/icon.tsx";
import type { PanelTabChrome } from "@shared/contracts/panel.ts";
import { absoluteDiskSourcePath } from "../document/paths.ts";
import { parseFilesDocumentPanelSource } from "../document/types.ts";

/**
 * File tab chrome: icon + tooltip with full identity.
 * Disk tabs show absolute path in tooltip (short title remains basename).
 * Untitled tabs show the document name.
 */
export function filesPanelTabChrome(
  params: Readonly<Record<string, unknown>>
): PanelTabChrome | undefined {
  const source = parseFilesDocumentPanelSource(params);
  if (!source) {
    return;
  }
  if (source.kind === "disk") {
    const absolutePath = absoluteDiskSourcePath(source.root, source.path);
    const basename =
      source.path.split(/[\\/]/).filter(Boolean).at(-1) ?? source.path;
    return {
      icon: {
        id: fileTabIconId(source.path),
      },
      title: basename,
      tooltip: {
        title: absolutePath,
      },
    };
  }
  return {
    icon: {
      id: fileTabIconId(source.name),
    },
    title: source.name,
    tooltip: {
      title: source.name,
    },
  };
}
