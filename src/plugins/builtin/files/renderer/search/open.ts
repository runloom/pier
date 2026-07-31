/**
 * Open a content-search hit in a files editor tab and reveal the match range.
 *
 * Reveal uses **line + UTF-16 char offsets within the line** (not absolute file
 * bytes), so LF-normalized / BOM-stripped editor buffers stay correct.
 */
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { FileContentQueryItem } from "@shared/contracts/file/query.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { FILES_FILE_PANEL_ID } from "../../manifest.ts";
import { getDocument } from "../document/store.ts";
import {
  parseFilesDocumentPanelSource,
  sameFilesDocumentPanelSource,
} from "../document/types.ts";
import type { FileEditorController } from "../editor/controller.ts";
import { createFileEditorSessionId } from "../editor/session-id.ts";
import { createFileFilePanelInstanceId } from "../panel/id.ts";
import { sourceTitle } from "../panel/source.ts";

/**
 * Map 1-based line + 0-based char index to an offset in LF-normalized text.
 */
export function documentOffsetAtLineChar(
  contents: string,
  line1Based: number,
  char: number
): number {
  if (line1Based < 1 || contents.length === 0) {
    return 0;
  }
  let line = 1;
  let i = 0;
  while (line < line1Based && i < contents.length) {
    if (contents.charCodeAt(i) === 10 /* \n */) {
      line += 1;
    }
    i += 1;
  }
  if (line !== line1Based) {
    return contents.length;
  }
  let lineEnd = i;
  while (lineEnd < contents.length && contents.charCodeAt(lineEnd) !== 10) {
    lineEnd += 1;
  }
  return Math.min(i + Math.max(0, char), lineEnd);
}

export function openContentSearchHit(input: {
  context: RendererPluginContext;
  controller: FileEditorController;
  hit: FileContentQueryItem;
  panelContext: PanelContext | null;
  root: string;
  targetGroupId?: string | undefined;
}): void {
  const source = {
    kind: "disk" as const,
    path: input.hit.path,
    root: input.root,
  };

  const existingInstance = input.context.panels
    .listInstances(FILES_FILE_PANEL_ID)
    .find((instance) => {
      if (
        input.targetGroupId !== undefined &&
        instance.groupId !== input.targetGroupId
      ) {
        return false;
      }
      return sameFilesDocumentPanelSource(
        parseFilesDocumentPanelSource(instance.params),
        source
      );
    });

  const instanceId =
    existingInstance?.id ?? createFileFilePanelInstanceId(source);
  const existingSource = parseFilesDocumentPanelSource(
    existingInstance?.params
  );
  const params = existingInstance?.params
    ? { ...existingInstance.params }
    : { pinned: false, source };

  input.controller.showSourceMode(instanceId);
  input.context.panels.openInstance({
    componentId: FILES_FILE_PANEL_ID,
    ...(!existingInstance && input.panelContext
      ? { context: input.panelContext }
      : {}),
    dropUnpinnedInstances: !existingInstance,
    instanceId,
    params,
    ...(input.targetGroupId ? { targetGroupId: input.targetGroupId } : {}),
    title: sourceTitle(existingSource ?? source),
  });

  const documentId = input.controller.documentId(source);
  const editorSessionId = createFileEditorSessionId(instanceId);

  const applyReveal = (): boolean => {
    const document = getDocument(documentId);
    if (document?.loadState !== "loaded") {
      return false;
    }
    const blocked =
      document.readOnlyReason === "binary" ||
      document.readOnlyReason === "too-large" ||
      document.readOnlyReason === "unknown-encoding" ||
      document.readOnlyReason === "unsupported-file";
    if (blocked) {
      return false;
    }
    const from = documentOffsetAtLineChar(
      document.currentContents,
      input.hit.line,
      input.hit.matchCharStart
    );
    const to = documentOffsetAtLineChar(
      document.currentContents,
      input.hit.line,
      input.hit.matchCharEnd
    );
    return input.controller.revealRange(
      editorSessionId,
      from,
      Math.max(from, to),
      documentId
    );
  };

  if (applyReveal()) {
    return;
  }

  let attempts = 0;
  const timer = window.setInterval(() => {
    attempts += 1;
    if (applyReveal() || attempts >= 40) {
      window.clearInterval(timer);
    }
  }, 50);
}
