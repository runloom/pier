import { nonEmptyFileRootRelativePathSchema } from "@shared/contracts/file.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { z } from "zod";

export type FilesDocumentLanguage =
  | "cpp"
  | "css"
  | "go"
  | "html"
  | "java"
  | "javascript"
  | "json"
  | "kotlin"
  | "markdown"
  | "python"
  | "ruby"
  | "rust"
  | "shell"
  | "sql"
  | "swift"
  | "text"
  | "toml"
  | "typescript"
  | "xml"
  | "yaml";

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

export function sameFilesDocumentPanelSource(
  left: FilesDocumentPanelSource | null | undefined,
  right: FilesDocumentPanelSource | null | undefined
): boolean {
  if (!(left && right) || left.kind !== right.kind) {
    return false;
  }
  if (left.kind === "untitled" && right.kind === "untitled") {
    return left.id === right.id;
  }
  if (left.kind === "disk" && right.kind === "disk") {
    return left.root === right.root && left.path === right.path;
  }
  return false;
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
  /** Disk mtime captured at last successful load/save; used for write conflict checks. */
  baseMtimeMs: number | null;
  capabilities: readonly FilesDocumentCapability[];
  /** 冲突 Compare 拉取的磁盘快照;非冲突态为 null。 */
  conflictDiskContents: string | null;
  currentContents: string;
  dirty: boolean;
  /** True when disk changed under an unsaved (dirty) document. */
  diskConflict: boolean;
  error: string | null;
  id: string;
  language: FilesDocumentLanguage;
  loadState: "error" | "idle" | "loaded" | "loading";
  name: string;
  readOnly: boolean;
  savedContents: string;
  saveState: "idle" | "saving";
  source: FilesDocumentSource;
}

export interface EditorRange {
  endCol: number;
  endLine: number;
  from: number;
  startCol: number;
  startLine: number;
  to: number;
}
