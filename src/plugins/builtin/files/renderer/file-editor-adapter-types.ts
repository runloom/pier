import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { FileEditorController } from "./file-editor-controller.ts";
import type { EditorRange, FileViewMode } from "./files-document-types.ts";
import type {
  MarkdownDiskSource,
  MarkdownFileResources,
  MarkdownInternalTarget,
  MarkdownRendererLabels,
} from "./markdown-ir-renderer.tsx";

export interface FileEditorAdapterLabels {
  diffUnsupported: string;
  richUnsupported: string;
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

export interface FileEditorAdapterProps {
  controller: FileEditorController;
  documentId: string;
  editorSessionId: string;
  labels?: FileEditorAdapterLabels;
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
        collapse: string;
        expand: string;
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
  panelId?: string | undefined;
  readOnly?: boolean;
  registerSelectionSelectAllProvider?:
    | RendererPluginContext["contextMenu"]["registerSelectionSelectAllProvider"]
    | undefined;
  searchLabels?: FilesEditorSearchLabels;
  searchRequest?: number;
  value: string;
}
