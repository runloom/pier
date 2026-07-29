import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { EditorSearchState } from "./code-mirror-search-state.ts";
import type { FileEditorController } from "./file-editor-controller.ts";
import type {
  EditorRange,
  FilesDocumentLanguage,
  FileViewMode,
} from "./files-document-types.ts";
import type { FilesTranslate } from "./files-i18n.ts";
import type {
  FilesLspHoverInput,
  FilesLspHoverLabels,
} from "./files-lsp-hover-types.ts";
import type {
  MarkdownDiskSource,
  MarkdownFileResources,
  MarkdownInternalTarget,
  MarkdownRendererLabels,
} from "./markdown-ir-renderer.tsx";

export interface FileEditorAdapterLabels {
  diffUnsupported: string;
  lspHover: FilesLspHoverLabels;
  sourceEditor: string;
}

export interface FilesEditorSearchLabels {
  close: string;
  matchAnnouncement: string;
  matchCase?: string;
  next: string;
  noMatches: string;
  placeholder: string;
  previous: string;
  regexp?: string;
  replace?: string;
  replaceAll?: string;
  replacePlaceholder?: string;
  selectAll?: string;
  wholeWord?: string;
}

export type FileEditorLspHoverResult = "shown" | "queued" | "unavailable";

export interface FileEditorViewPresentation {
  ariaLabel: string;
  getLspHoverLabels?: FilesLspHoverInput["getLabels"];
  notifyLspError?: FilesLspHoverInput["notifyError"];
  onContextMenu?: (event: MouseEvent, ranges: readonly EditorRange[]) => void;
  onOpenSearch: () => void;
  onSearchStateChange: (state: EditorSearchState) => void;
  openExternal: (url: string) => void;
  readDocument?: FilesLspHoverInput["readDocument"];
}

export interface FileEditorAdapterProps {
  canvasDiskSource?: { path: string; root: string } | undefined;
  context?: RendererPluginContext | undefined;
  controller: FileEditorController;
  documentId: string;
  editorSessionId: string;
  labels?: FileEditorAdapterLabels;
  language?: FilesDocumentLanguage | undefined;
  markdownAppearance?: RendererPluginContext["appearance"] | undefined;
  markdownCharts?: RendererPluginContext["charts"] | undefined;
  markdownCopyCode?: ((code: string) => Promise<void>) | undefined;
  markdownErrorLabel?: string | undefined;
  markdownFileResources?: MarkdownFileResources | undefined;
  markdownInitialAnchor?: string | undefined;
  markdownInitialAnchorRequestId?: string | undefined;
  markdownLabels?: MarkdownRendererLabels | undefined;
  markdownSource?: MarkdownDiskSource | undefined;
  markdownTocLabels?:
    | {
        title: string;
      }
    | undefined;
  markdownZoomLabels?:
    | {
        reset: string;
        zoomIn: string;
        zoomOut: string;
      }
    | undefined;
  mode: FileViewMode;
  onEditorContextMenu?: (
    event: MouseEvent,
    ranges: readonly EditorRange[]
  ) => void;
  onJumpToSource?: ((offset: number) => void) | undefined;
  onMarkdownPreviewContextMenu?: (
    event: ReactMouseEvent<HTMLDivElement>
  ) => void;
  onOpenMarkdownInternal?:
    | ((target: MarkdownInternalTarget) => void)
    | undefined;
  openExternal: (url: string) => void;
  originalValue?: string;
  /** Workspace context for LSP worktree policy. */
  panelContext?: PanelContext | undefined;
  panelId?: string | undefined;
  readOnly?: boolean;
  registerSelectionSelectAllProvider?:
    | RendererPluginContext["contextMenu"]["registerSelectionSelectAllProvider"]
    | undefined;
  searchLabels?: FilesEditorSearchLabels;
  searchRequest?: number;
  t?: FilesTranslate | undefined;
  value: string;
}
