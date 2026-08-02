import type { PanelContext } from "@shared/contracts/panel.ts";
import { getDocument } from "../document/store.ts";
import type { FilePathMutationGuardCoordinator } from "../mutation/path-guard.ts";
import type { FileEditorControllerViewCommands } from "./controller-view-commands.ts";
import type { FilesEditorGitGutterController } from "./git-gutter-controller.ts";
import type { FilesEditorPrefs } from "./prefs.ts";
import type { FileEditorViewCoordinator } from "./view-coordinator.ts";
import type { FileEditorViewPresentation } from "./view-session.ts";

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
  // Content reveal (mode switch / go-to) owns scroll; do not fight it with
  // the previous source-mode pixel snapshot on remount.
  const restoreScroll = !input.viewCommands.hasPendingReveal(
    input.editorSessionId,
    document.id
  );
  input.views.attach({
    document,
    editorPrefs: input.editorPrefs,
    editorSessionId: input.editorSessionId,
    minimapEnabled: input.minimapEnabled,
    ...(input.panelContext ? { panelContext: input.panelContext } : {}),
    parent: input.parent,
    presentation: input.presentation,
    restoreScroll,
  });
  const session = input.views.getSession(input.editorSessionId);
  if (session) {
    input.gitGutter.attach(input.editorSessionId, document, session);
    input.viewCommands.consumeAttached(input.editorSessionId, document.id);
  }
  input.pathMutationGuards.syncSessions();
}
