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
  anchorCopied: "Anchor copied",
  copiedCode: "Copied",
  copyAnchor: "Copy heading anchor",
  copyCode: "Copy code",
  wrapOff: "Word Wrap: Off",
  wrapOn: "Word Wrap: On",
  completedTask: "Completed task",
  diagramFailed: "Unable to render diagram",
  diagramLabel: "Mermaid diagram",
  diagramPreviewTitle: "Diagram preview",
  imagePreviewFailed: "Unable to open image preview",
  imagePreviewTitle: "Image",
  incompleteTask: "Incomplete task",
  openFullscreen: "View fullscreen",
  resizeColumn: "Resize column",
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
