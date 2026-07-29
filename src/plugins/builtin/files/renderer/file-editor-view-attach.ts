import type { PanelContext } from "@shared/contracts/panel.ts";
import type { FileEditorControllerViewCommands } from "./file-editor-controller-view-commands.ts";
import type { FileEditorViewCoordinator } from "./file-editor-view-coordinator.ts";
import type { FileEditorViewPresentation } from "./file-editor-view-session.ts";
import type { FilePathMutationGuardCoordinator } from "./file-path-mutation-guard.ts";
import { getDocument } from "./files-document-store.ts";
import type { FilesEditorGitGutterController } from "./files-editor-git-gutter-controller.ts";
import type { FilesEditorPrefs } from "./files-editor-prefs.ts";

export function attachFileEditorView(input: {
  documentId: string;
  editorPrefs: FilesEditorPrefs;
  editorSessionId: string;
  gitGutter: FilesEditorGitGutterController;
  minimapEnabled: boolean;
  panelContext?: PanelContext;
  parent: HTMLElement;
  pathMutationGuards: FilePathMutationGuardCoordinator;
  viewCommands: FileEditorControllerViewCommands;
  presentation: FileEditorViewPresentation;
  views: FileEditorViewCoordinator;
}): void {
  const document = getDocument(input.documentId);
  if (!document) {
    return;
  }
  input.pathMutationGuards.syncDocument(document);
  input.views.attach({
    document,
    editorPrefs: input.editorPrefs,
    editorSessionId: input.editorSessionId,
    minimapEnabled: input.minimapEnabled,
    ...(input.panelContext ? { panelContext: input.panelContext } : {}),
    parent: input.parent,
    presentation: input.presentation,
  });
  const session = input.views.getSession(input.editorSessionId);
  if (session) {
    input.gitGutter.attach(input.editorSessionId, document, session);
    input.viewCommands.consumeAttached(input.editorSessionId, document.id);
  }
  input.pathMutationGuards.syncSessions();
}
