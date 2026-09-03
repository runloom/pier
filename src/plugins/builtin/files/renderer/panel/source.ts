import type { PierDockviewGroupHandle } from "@shared/contracts/dockview.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { diskDocumentId } from "../document/paths.ts";
import {
  type FilesDocument,
  type FilesDocumentPanelSource,
  isDiskSourceRootAllowed,
  parseFilesDocumentPanelSource,
} from "../document/types.ts";
import type { FilesTranslate } from "../i18n.ts";

export type ParsedPanelSourceState =
  | { kind: "empty" }
  | { kind: "invalid"; message: string; title: string }
  | { kind: "source"; source: FilesDocumentPanelSource };

export function panelSourceForDocument(
  document: FilesDocument | null
): FilesDocumentPanelSource | null {
  if (!document) {
    return null;
  }
  if (document.source.kind === "untitled") {
    return { id: document.source.id, kind: "untitled", name: document.name };
  }
  const defaultId = diskDocumentId(document.source.root, document.source.path);
  if (document.id !== defaultId) {
    return {
      documentId: document.id,
      kind: "disk",
      path: document.source.path,
      root: document.source.root,
    };
  }
  return {
    kind: "disk",
    path: document.source.path,
    root: document.source.root,
  };
}

export function sourceTitle(source: FilesDocumentPanelSource): string {
  if (source.kind === "untitled") {
    return source.name;
  }
  return source.path.split("/").filter(Boolean).at(-1) ?? source.path;
}

export function breadcrumbSegmentsForSource(
  source: FilesDocumentPanelSource,
  projectName: string | null
): string[] {
  if (source.kind === "untitled") {
    return [source.name];
  }
  const parts = source.path.split("/").filter(Boolean);
  if (projectName && projectName.length > 0) {
    return [projectName, ...parts];
  }
  return parts;
}

/** Outside-workspace docs: real root + path, never the current project name. */
export function breadcrumbSegmentsForPanelSource(
  source: FilesDocumentPanelSource,
  projectName: string | null,
  outsideWorkspace: boolean
): string[] {
  if (source.kind === "disk" && outsideWorkspace) {
    const parts = source.path.split("/").filter(Boolean);
    return [source.root, ...parts];
  }
  return breadcrumbSegmentsForSource(source, projectName);
}

/**
 * Map a breadcrumb segment index to a project-relative tree path for reveal.
 *
 * When `projectName` prefixes the segments (`[project, ...pathParts]`):
 * - index 0 → `""` (project root)
 * - index k → first k path parts
 *
 * When there is no project prefix (`segments === pathParts`):
 * - index k → first k+1 path parts
 */
export function breadcrumbRevealPathForDiskSource(params: {
  path: string;
  projectName: string | null;
  segmentIndex: number;
}): string {
  const pathParts = params.path.split("/").filter(Boolean);
  const hasProjectName =
    params.projectName != null && params.projectName.length > 0;
  const maxIndex = hasProjectName ? pathParts.length : pathParts.length - 1;
  if (maxIndex < 0) {
    return "";
  }
  const clampedIndex = Math.max(0, Math.min(params.segmentIndex, maxIndex));
  const pathPrefixCount = hasProjectName ? clampedIndex : clampedIndex + 1;
  if (pathPrefixCount <= 0) {
    return "";
  }
  return pathParts.slice(0, pathPrefixCount).join("/");
}

/** True when params claim a document source, including null or malformed. */
export function hasFilesPanelSourceKey(
  params: unknown
): params is Record<string, unknown> {
  return Boolean(params && typeof params === "object" && "source" in params);
}

export function parseSourceState(
  params: unknown,
  t: FilesTranslate
): ParsedPanelSourceState {
  if (!hasFilesPanelSourceKey(params)) {
    return { kind: "empty" };
  }

  const source = parseFilesDocumentPanelSource(params);
  if (!source) {
    return {
      kind: "invalid",
      message: t(
        "filePanel.errors.invalidParams",
        "This file tab could not be restored."
      ),
      title: t("filePanel.title", "File"),
    };
  }

  return { kind: "source", source };
}

export function asGroupHandle(value: unknown): PierDockviewGroupHandle | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string") {
    return null;
  }
  if (!record.api || typeof record.api !== "object") {
    return null;
  }
  return value as PierDockviewGroupHandle;
}

/**
 * Outside-workspace facts for a panel source: `outsideWorkspace` drives the
 * content banner; `externalActiveFile` surfaces the doc pinned above a tree
 * that stays rooted at the panel's project root.
 */
export function outsideWorkspaceStateFor(
  source: FilesDocumentPanelSource | null | undefined,
  root: string | null | undefined,
  context: PanelContext | null | undefined
): {
  externalActiveFile: { path: string; root: string } | null;
  outsideWorkspace: boolean;
} {
  const outsideWorkspace =
    source?.kind === "disk" && !isDiskSourceRootAllowed(source.root, context);
  return {
    externalActiveFile:
      outsideWorkspace && root
        ? { path: source.path, root: source.root }
        : null,
    outsideWorkspace,
  };
}
