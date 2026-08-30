import {
  type FileDocumentEol,
  type FileDocumentFormat,
  type FilePreviewImageMime,
  type FileWritableDocumentEol,
  nonEmptyFileRootRelativePathSchema,
} from "@shared/contracts/file.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { z } from "zod";
import { absoluteDiskSourcePath, diskDocumentId } from "./paths.ts";

/** Built-in Files editor languages (L0). Plugin / L1 modes use additional string ids. */
export type BuiltinFilesDocumentLanguage =
  | "astro"
  | "canvas"
  | "cpp"
  | "csharp"
  | "css"
  | "dart"
  | "dockerfile"
  | "elixir"
  | "go"
  | "graphql"
  | "html"
  | "java"
  | "javascript"
  | "json"
  | "kotlin"
  | "lua"
  | "markdown"
  | "php"
  | "python"
  | "r"
  | "ruby"
  | "rust"
  | "scala"
  | "shell"
  | "sql"
  | "svelte"
  | "svg"
  | "swift"
  | "terraform"
  | "text"
  | "toml"
  | "typescript"
  | "vue"
  | "xml"
  | "yaml"
  | "zig";

/**
 * Document language id: L0 builtins or dynamic plugin/L1 mode ids.
 */
export type FilesDocumentLanguage =
  | BuiltinFilesDocumentLanguage
  | (string & {});

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
    documentId: z.string().min(1).optional(),
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

export function resolveDiskDocumentId(source: {
  documentId?: string | undefined;
  path: string;
  root: string;
}): string {
  return source.documentId ?? diskDocumentId(source.root, source.path);
}

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
    // 迁移面板带显式 documentId：同 id 即同文档；否则回退到规范化绝对路径
    // （同文件不同 root/path 切分也判同源）。
    if (resolveDiskDocumentId(left) === resolveDiskDocumentId(right)) {
      return true;
    }
    return (
      absoluteDiskSourcePath(left.root, left.path) ===
      absoluteDiskSourcePath(right.root, right.path)
    );
  }
  return false;
}

export function isDiskSourceRootAllowed(
  root: string,
  context: PanelContext | null | undefined
): boolean {
  const normalizedRoot = normalizeFsPath(root);
  if (normalizedRoot.length === 0) {
    return false;
  }
  const anchors = [
    context?.projectRootPath,
    context?.worktreeRoot,
    context?.gitRoot,
    context?.cwd,
    context?.openedPath,
  ]
    .filter((candidate): candidate is string => typeof candidate === "string")
    .map(normalizeFsPath)
    .filter((candidate) => candidate.length > 0);
  if (anchors.some((candidate) => candidate === normalizedRoot)) {
    return true;
  }
  // Layout restore can briefly lack params.context while source.root is still
  // the repo that opened the tab. Don't block a self-consistent disk source.
  // Fail-open is restore UX only: when any anchor exists, non-matching roots are denied.
  return anchors.length === 0;
}

function normalizeFsPath(path: string): string {
  if (path.length <= 1) {
    return path;
  }
  return path.endsWith("/") || path.endsWith("\\") ? path.slice(0, -1) : path;
}

export type FileViewMode = "diff" | "preview" | "source";

// Document save capabilities only. Path ops (delete/move/rename/reveal) live on
// tree actions, not the document capability list.
export type FilesDocumentCapability = "save" | "saveAs";

export interface FilesDocument {
  /** Disk mtime captured at last successful load/save; used for write conflict checks. */
  baseMtimeMs: number | null;
  canonicalPath: string | null;
  capabilities: readonly FilesDocumentCapability[];
  /** 冲突 Compare 拉取的磁盘快照;非冲突态为 null。 */
  conflictDiskContents: string | null;
  createdEmptyEol: FileWritableDocumentEol | null;
  currentContents: string;
  deletedOnDisk: boolean;
  dirty: boolean;
  /** True when disk changed under an unsaved (dirty) document. */
  diskConflict: boolean;
  durabilityUnknown: boolean;
  eol: FileDocumentEol | null;
  error: string | null;
  /** Read failed with EPERM (TCC); UI on macOS shows the Files & Folders guide. */
  folderAccessBlocked?: boolean;
  format: FileDocumentFormat | null;
  hasBackingStore: boolean;
  id: string;
  language: FilesDocumentLanguage;
  /** User picker overrode `languageForPath`; live-modules refresh must not restamp. */
  languageOverridden?: boolean;
  loadState: "error" | "idle" | "loaded" | "loading";
  mime: string | null;
  mode: number | null;
  name: string;
  needsSaveAs: boolean;
  preview: {
    kind: "image";
    mime: FilePreviewImageMime;
    revision: string;
  } | null;
  readOnly: boolean;
  readOnlyReason:
    | "binary"
    | "mixed-eol"
    | "not-writable"
    | "too-large"
    | "unknown-encoding"
    | "unsupported-file"
    | null;
  revision: string | null;
  savedContents: string;
  savedEol: FileDocumentEol | null;
  savedFormat: FileDocumentFormat | null;
  saveState: "idle" | "saving";
  size: number | null;
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
