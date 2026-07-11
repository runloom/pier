import type { PierDockviewGroupHandle } from "@shared/contracts/dockview.ts";
import {
  type FilesDocument,
  type FilesDocumentPanelSource,
  parseFilesDocumentPanelSource,
} from "./files-document-types.ts";
import type { FilesTranslate } from "./files-i18n.ts";

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
  return document.source.kind === "disk"
    ? document.source
    : { id: document.source.id, kind: "untitled", name: document.name };
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

export function parseSourceState(
  params: unknown,
  t: FilesTranslate
): ParsedPanelSourceState {
  if (!params || typeof params !== "object" || !("source" in params)) {
    return { kind: "empty" };
  }

  const source = parseFilesDocumentPanelSource(params);
  if (!source) {
    return {
      kind: "invalid",
      message: t(
        "filePanel.errors.invalidParams",
        "The saved panel parameters are invalid."
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
