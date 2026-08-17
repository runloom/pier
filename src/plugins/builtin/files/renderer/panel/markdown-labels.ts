import type {
  FileEditorAdapterLabels,
  FilesEditorSearchLabels,
} from "../editor/adapter-types.ts";
import type { FilesTranslate } from "../i18n.ts";
import type { FilesLspHoverLabels } from "../lsp/hover-types.ts";
import type { MarkdownPreviewCommentLabels } from "../markdown/comments/preview-layer.tsx";
import type { MarkdownRendererLabels } from "../markdown/ir-renderer.tsx";

export const DEFAULT_FILES_LSP_HOVER_LABELS: FilesLspHoverLabels = {
  contentTruncated: "Documentation was truncated",
  definitionsTitle: "Definitions",
  definitionsTruncated: "Only the first definitions are shown",
  documentationTitle: "Documentation",
  goToDefinitionFailed: "Unable to open that definition.",
  goToDefinitionUnavailable: "Go to Definition is unavailable here.",
  lineTruncated: "Line truncated",
  noInformation: "No symbol information is available here.",
  previewUnavailable: "Preview unavailable",
  symbolTitle: "Symbol information",
  unavailable: "Symbol information is temporarily unavailable.",
};

export function createFileEditorAdapterLabels(
  t: FilesTranslate
): FileEditorAdapterLabels {
  return {
    diffUnsupported: t(
      "filePanel.view.diffUnsupported",
      "No disk contents available to compare."
    ),
    lspHover: {
      contentTruncated: t(
        "filePanel.editor.hover.contentTruncated",
        DEFAULT_FILES_LSP_HOVER_LABELS.contentTruncated
      ),
      definitionsTitle: t(
        "filePanel.editor.hover.definitionsTitle",
        DEFAULT_FILES_LSP_HOVER_LABELS.definitionsTitle
      ),
      definitionsTruncated: t(
        "filePanel.editor.hover.definitionsTruncated",
        DEFAULT_FILES_LSP_HOVER_LABELS.definitionsTruncated
      ),
      documentationTitle: t(
        "filePanel.editor.hover.documentationTitle",
        DEFAULT_FILES_LSP_HOVER_LABELS.documentationTitle
      ),
      goToDefinitionFailed: t(
        "filePanel.editor.goToDefinition.failed",
        DEFAULT_FILES_LSP_HOVER_LABELS.goToDefinitionFailed
      ),
      goToDefinitionUnavailable: t(
        "filePanel.editor.goToDefinition.unavailable",
        DEFAULT_FILES_LSP_HOVER_LABELS.goToDefinitionUnavailable
      ),
      lineTruncated: t(
        "filePanel.editor.hover.lineTruncated",
        DEFAULT_FILES_LSP_HOVER_LABELS.lineTruncated
      ),
      noInformation: t(
        "filePanel.editor.hover.noInformation",
        DEFAULT_FILES_LSP_HOVER_LABELS.noInformation
      ),
      previewUnavailable: t(
        "filePanel.editor.hover.previewUnavailable",
        DEFAULT_FILES_LSP_HOVER_LABELS.previewUnavailable
      ),
      symbolTitle: t(
        "filePanel.editor.hover.symbolTitle",
        DEFAULT_FILES_LSP_HOVER_LABELS.symbolTitle
      ),
      unavailable: t(
        "filePanel.editor.hover.unavailable",
        DEFAULT_FILES_LSP_HOVER_LABELS.unavailable
      ),
    },
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

export function createMarkdownCommentLabels(
  t: FilesTranslate
): MarkdownPreviewCommentLabels {
  return {
    addComment: t("filePanel.markdown.comment.add", "Add comment"),
    authorYou: t("filePanel.markdown.comment.authorYou", "You"),
    close: t("filePanel.markdown.comment.close", "Close"),
    createFailed: t(
      "filePanel.markdown.comment.createFailed",
      "Couldn’t create comment"
    ),
    deleteComment: t("filePanel.markdown.comment.delete", "Delete"),
    deleteFailed: t(
      "filePanel.markdown.comment.deleteFailed",
      "Couldn’t delete comment"
    ),
    deleted: t("filePanel.markdown.comment.deleted", "Deleted"),
    driftTitle: t(
      "filePanel.markdown.comment.driftTitle",
      "Comments that can no longer be located precisely"
    ),
    cancel: t("filePanel.markdown.comment.cancel", "Cancel"),
    editComment: t("filePanel.markdown.comment.edit", "Edit"),
    inputPlaceholder: t(
      "filePanel.markdown.comment.placeholder",
      "Add comment..."
    ),
    save: t("filePanel.markdown.comment.save", "Save"),
    submit: t("filePanel.markdown.comment.submit", "Submit"),
    title: t("filePanel.markdown.comment.title", "Comment"),
    updateFailed: t(
      "filePanel.markdown.comment.updateFailed",
      "Couldn’t update comment"
    ),
    viewComment: t("filePanel.markdown.comment.view", "View comment"),
    viewComments: t(
      "filePanel.markdown.comment.viewCount",
      "View {{count}} comments"
    ),
  };
}
