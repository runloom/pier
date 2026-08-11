import type { MarkdownRendererLabels } from "./ir-renderer.tsx";

export interface MarkdownPreviewTocLabels {
  title: string;
}

export interface MarkdownPreviewZoomLabels {
  reset: string;
  zoomIn: string;
  zoomOut: string;
}

export const DEFAULT_RENDERER_LABELS: MarkdownRendererLabels = {
  copiedCode: "Copied",
  copyCode: "Copy code",
  completedTask: "Completed task",
  diagramFailed: "Unable to render diagram",
  diagramLabel: "Mermaid diagram",
  diagramPreviewTitle: "Diagram preview",
  imagePreviewFailed: "Unable to open image preview",
  imagePreviewTitle: "Image",
  incompleteTask: "Incomplete task",
  openFullscreen: "View fullscreen",
};

export const DEFAULT_TOC_LABELS: MarkdownPreviewTocLabels = {
  title: "Outline",
};

export const DEFAULT_ZOOM_LABELS: MarkdownPreviewZoomLabels = {
  reset: "Reset text size",
  zoomIn: "Increase text size",
  zoomOut: "Decrease text size",
};

export const EMPTY_HEADING_IDS: readonly string[] = [];
