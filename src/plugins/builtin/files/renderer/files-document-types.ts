import { nonEmptyFileRootRelativePathSchema } from "@shared/contracts/file.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { z } from "zod";

export type FilesDocumentLanguage = "markdown" | "text";

export interface FilesDocumentOrigin {
  panelId?: string;
  source: "project-file-tree" | "terminal-selection";
}

export type FilesDocumentSource =
  | { kind: "disk"; path: string; root: string }
  | {
      id: string;
      kind: "untitled";
      language: FilesDocumentLanguage;
      name: string;
      origin?: FilesDocumentOrigin;
    };

export const filesDocumentPanelSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("disk"),
    path: nonEmptyFileRootRelativePathSchema,
    root: z.string().min(1),
  }),
  z.object({
    id: z.string().min(1),
    kind: z.literal("untitled"),
    name: z.string().min(1),
  }),
]);

export type FilesDocumentPanelSource = z.infer<
  typeof filesDocumentPanelSourceSchema
>;

export function parseFilesDocumentPanelSource(
  params: unknown
): FilesDocumentPanelSource | null {
  if (!params || typeof params !== "object" || !("source" in params)) {
    return null;
  }
  const parsed = filesDocumentPanelSourceSchema.safeParse(params.source);
  return parsed.success ? parsed.data : null;
}

export function isDiskSourceRootAllowed(
  root: string,
  context: PanelContext | null | undefined
): boolean {
  return [
    context?.projectRootPath,
    context?.worktreeRoot,
    context?.gitRoot,
    context?.cwd,
    context?.openedPath,
  ].some((candidate) => candidate === root);
}

export type FileViewMode = "diff" | "preview" | "rich" | "source";

// Reserved document-operation vocabulary. Current capability assignment is
// intentionally narrower than this union: disk text files may save, while
// temporary Markdown files have no file-system capabilities. Enabling any
// other operation requires adding matching UI, confirmation flows, and tests.
export type FilesDocumentCapability =
  | "delete"
  | "move"
  | "rename"
  | "reveal"
  | "save"
  | "saveAs";

export interface FilesDocument {
  capabilities: readonly FilesDocumentCapability[];
  currentContents: string;
  dirty: boolean;
  error: string | null;
  id: string;
  language: FilesDocumentLanguage;
  loadState: "error" | "idle" | "loaded" | "loading";
  name: string;
  readOnly: boolean;
  savedContents: string;
  source: FilesDocumentSource;
}

export interface FileEditorAdapterLabels {
  diffUnsupported: string;
  richUnsupported: string;
  sourceEditor: string;
}

export interface FileEditorAdapterProps {
  labels?: FileEditorAdapterLabels;
  language: FilesDocumentLanguage | string;
  mode: FileViewMode;
  onChange?: (value: string) => void;
  originalValue?: string;
  readOnly?: boolean;
  value: string;
}
