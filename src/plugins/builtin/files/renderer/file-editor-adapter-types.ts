import type { RendererPluginContext } from "@plugins/api/renderer.ts";
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
  mode: FileViewMode;
  onEditorContextMenu?: (
    event: MouseEvent,
    ranges: readonly EditorRange[]
  ) => void;
  onOpenMarkdownInternal?:
    | ((target: MarkdownInternalTarget) => void)
    | undefined;
  openExternal: (url: string) => void;
  originalValue?: string;
  readOnly?: boolean;
  searchLabels?: FilesEditorSearchLabels;
  searchRequest?: number;
  value: string;
}
