import type { MarkdownRendererLabels } from "./ir-renderer.tsx";

export interface MarkdownPreviewTocLabels {
  title: string;
}

export interface MarkdownPreviewZoomLabels {
  controlsLabel: string;
  reset: string;
  zoomIn: string;
  zoomLevel: string;
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
  columnWidthAuto: "Automatic width",
  resizeColumn: "Resize column. Double-click to restore automatic sizing.",
  appletDisabledTitle: "Applets are off for this document",
  appletDisabledBody:
    "Add <!-- pier-applets: enable --> near the top to mount this applet.",
  appletParseFailedTitle: "Couldn’t read this applet fence",
  appletParseFailedBody:
    "Use JSON with pluginId, appletId, and optional props.",
  appletMountFailedBody:
    "Retry. If it still fails, check that the plugin is installed.",
  appletMountFailedTitle: "Couldn’t mount the applet",
};

export const DEFAULT_TOC_LABELS: MarkdownPreviewTocLabels = {
  title: "Outline",
};

export const DEFAULT_ZOOM_LABELS: MarkdownPreviewZoomLabels = {
  controlsLabel: "Text size",
  reset: "Reset text size",
  zoomIn: "Increase text size",
  zoomLevel: "Text size",
  zoomOut: "Decrease text size",
};

export const EMPTY_HEADING_IDS: readonly string[] = [];
