import type { FileEditorViewCoordinator } from "./file-editor-view-coordinator.ts";
import type { FilesMutationSuspendCoordinator } from "./files-mutation-suspend-coordinator.ts";

export function createFileEditorTransferSupport(input: {
  mutationSuspend: FilesMutationSuspendCoordinator;
  views: FileEditorViewCoordinator;
}) {
  return {
    applyViewSnapshot(
      editorSessionId: string,
      snapshot: {
        selection?: { anchor: number; head: number };
        scroll?: { left: number; top: number };
      }
    ): void {
      input.views.applySnapshot(editorSessionId, snapshot);
    },
    captureViewSnapshot(documentId: string): {
      selection?: { anchor: number; head: number };
      scroll?: { left: number; top: number };
    } | null {
      const snapshot = input.views.captureDocumentSnapshot(documentId);
      if (!snapshot) {
        return null;
      }
      return {
        ...(snapshot.selection ? { selection: snapshot.selection } : {}),
        scroll: snapshot.scroll,
      };
    },
    resumeTransferMutations(scope: {
      documentId: string;
      panelId: string;
    }): void {
      input.mutationSuspend.resume({ kind: "transfer", ...scope });
    },
    suspendTransferMutations(
      scope: { documentId: string; panelId: string },
      signal: AbortSignal
    ): Promise<void> {
      return input.mutationSuspend.suspend(
        { kind: "transfer", ...scope },
        signal
      );
    },
  };
}

export type FileEditorTransferSupport = ReturnType<
  typeof createFileEditorTransferSupport
>;
