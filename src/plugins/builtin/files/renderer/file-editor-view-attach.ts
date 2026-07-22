import type { FileEditorViewCoordinator } from "./file-editor-view-coordinator.ts";
import type { FileEditorViewPresentation } from "./file-editor-view-session.ts";
import type { FilePathMutationGuardCoordinator } from "./file-path-mutation-guard.ts";
import { getDocument } from "./files-document-store.ts";
import type { FilesEditorGitGutterController } from "./files-editor-git-gutter-controller.ts";

export function attachFileEditorView(input: {
  documentId: string;
  editorSessionId: string;
  gitGutter: FilesEditorGitGutterController;
  minimapEnabled: boolean;
  parent: HTMLElement;
  pathMutationGuards: FilePathMutationGuardCoordinator;
  pendingReveals: Map<string, number>;
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
    editorSessionId: input.editorSessionId,
    minimapEnabled: input.minimapEnabled,
    parent: input.parent,
    presentation: input.presentation,
  });
  const session = input.views.getSession(input.editorSessionId);
  if (session) {
    input.gitGutter.attach(input.editorSessionId, document, session);
    const pendingReveal = input.pendingReveals.get(input.editorSessionId);
    if (pendingReveal !== undefined) {
      input.pendingReveals.delete(input.editorSessionId);
      session.revealOffset(pendingReveal);
    }
  }
  input.pathMutationGuards.syncSessions();
}
