import { fileTabIconId } from "@pier/ui/file/icon.tsx";
import {
  type PanelContext,
  type PanelTabChrome,
  panelContextSchema,
} from "@shared/contracts/panel.ts";
import { FILES_PROJECT_TAB_ICON_ID } from "../../manifest.ts";
import { absoluteDiskSourcePath } from "../document/paths.ts";
import { parseFilesDocumentPanelSource } from "../document/types.ts";
import { projectAnchor } from "../project/anchor.ts";
import { projectNameFromRoot } from "../tree/preferences.ts";
import { hasFilesPanelSourceKey } from "./source.ts";

function contextFromParams(
  params: Readonly<Record<string, unknown>>
): PanelContext | undefined {
  const parsed = panelContextSchema.safeParse(params.context);
  return parsed.success ? parsed.data : undefined;
}

function projectDirectoryTabChrome(
  params: Readonly<Record<string, unknown>>
): PanelTabChrome {
  const anchor = projectAnchor(contextFromParams(params));
  if (!anchor) {
    return { icon: { id: FILES_PROJECT_TAB_ICON_ID } };
  }
  return {
    icon: { id: FILES_PROJECT_TAB_ICON_ID },
    title: projectNameFromRoot(anchor),
    tooltip: { title: anchor },
  };
}

/**
 * File tab chrome: icon + tooltip with full identity.
 * Disk tabs show absolute path in tooltip (short title remains basename).
 * Untitled tabs show the document name.
 * Tree-only project panels (status bar / Open Directory) use the folder icon.
 */
export function filesPanelTabChrome(
  params: Readonly<Record<string, unknown>>
): PanelTabChrome | undefined {
  if (!hasFilesPanelSourceKey(params)) {
    return projectDirectoryTabChrome(params);
  }
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
