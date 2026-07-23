import type {
  FileEditorAdapterLabels,
  FilesEditorSearchLabels,
} from "./file-editor-adapter-types.ts";
import type { FilesTranslate } from "./files-i18n.ts";
import type { MarkdownRendererLabels } from "./markdown-ir-renderer.tsx";

export function createFileEditorAdapterLabels(
  t: FilesTranslate
): FileEditorAdapterLabels {
  return {
    diffUnsupported: t(
      "filePanel.view.diffUnsupported",
      "No disk contents available to compare."
    ),
    sourceEditor: t("filePanel.editor.sourceLabel", "Source editor"),
  };
}

export function createMarkdownRendererLabels(
  t: FilesTranslate
): MarkdownRendererLabels {
  return {
    copiedCode: t("filePanel.markdown.copiedCode", "Copied"),
    copyCode: t("filePanel.markdown.copyCode", "Copy code"),
    diagramFailed: t(
      "filePanel.markdown.diagramFailed",
      "Unable to render diagram"
    ),
    diagramLabel: t("filePanel.markdown.diagramLabel", "Mermaid diagram"),
    diagramPreviewTitle: t(
      "filePanel.markdown.diagramPreviewTitle",
      "Diagram preview"
    ),
    imagePreviewFailed: t(
      "filePanel.markdown.imagePreviewFailed",
      "Unable to open image preview"
    ),
    imagePreviewTitle: t("filePanel.markdown.imagePreviewTitle", "Image"),
    openFullscreen: t("filePanel.markdown.openFullscreen", "View fullscreen"),
    completedTask: t("filePanel.markdown.completedTask", "Completed task"),
    incompleteTask: t("filePanel.markdown.incompleteTask", "Incomplete task"),
  };
}

export function createMarkdownTocLabels(t: FilesTranslate): {
  title: string;
} {
  return {
    title: t("filePanel.markdown.toc.title", "Outline"),
  };
}

export function createMarkdownZoomLabels(t: FilesTranslate): {
  reset: string;
  zoomIn: string;
  zoomOut: string;
} {
  return {
    reset: t("filePanel.markdown.zoom.reset", "Reset text size"),
    zoomIn: t("filePanel.markdown.zoom.in", "Increase text size"),
    zoomOut: t("filePanel.markdown.zoom.out", "Decrease text size"),
  };
}

export function createFileSearchLabels(
  t: FilesTranslate
): FilesEditorSearchLabels {
  return {
    close: t("filePanel.search.close", "Close"),
    matchAnnouncement: t(
      "filePanel.search.matchAnnouncement",
      "Matches: {{count}}",
      { count: "{{count}}" }
    ),
    matchCase: t("filePanel.search.matchCase", "Match case"),
    next: t("filePanel.search.next", "Next match"),
    noMatches: t("filePanel.search.noMatches", "No matches"),
    placeholder: t("filePanel.search.placeholder", "Find"),
    previous: t("filePanel.search.previous", "Previous match"),
    regexp: t("filePanel.search.regexp", "Regexp"),
    replace: t("filePanel.search.replace", "Replace"),
    replaceAll: t("filePanel.search.replaceAll", "Replace all"),
    replacePlaceholder: t("filePanel.search.replacePlaceholder", "Replace"),
    selectAll: t("filePanel.search.selectAll", "Select all matches"),
    wholeWord: t("filePanel.search.wholeWord", "Whole word"),
  };
}

export function createMarkdownErrorLabel(t: FilesTranslate): string {
  return t(
    "filePanel.markdown.renderFailed",
    "Unable to render Markdown preview."
  );
}
