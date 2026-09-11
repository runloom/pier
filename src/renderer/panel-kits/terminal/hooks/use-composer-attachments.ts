import { annotatePierCanvasInvokeLocale } from "@shared/contracts/pier-canvas.ts";
import type { TerminalDraftComposition } from "@shared/contracts/terminal/draft.ts";
import {
  type ClipboardEvent,
  type DragEvent,
  useCallback,
  useEffect,
  useSyncExternalStore,
} from "react";
import { resolveLanguagePreference } from "@/i18n/language.ts";
import { useLocaleStore } from "@/stores/locale.store.ts";
import {
  runTerminalDraftMutation,
  writeTerminalDraftComposition,
} from "@/stores/terminal-drafts.store.ts";
import {
  collectComposerFiles,
  dtoToAttachment,
} from "../composer/attachment-files.ts";
import {
  enqueueComposerAttachmentMerge,
  readComposerAttachments,
  subscribeComposerSession,
  type TerminalComposerSession,
  writeComposerAttachments,
} from "../composer/session.ts";
import {
  buildComposerSendText,
  type ComposerAttachment,
  MAX_COMPOSER_SEND_TEXT_LENGTH,
  updatePasteAttachmentContent,
} from "../composer-attachments-model.ts";
import {
  dispatchComposerEdit,
  registerComposerEditHandler,
} from "../composer-bridge.ts";
import {
  type ComposerEditorMutations,
  insertComposerPlainTextAtCursor,
  mergeComposerAttachments,
  removeComposerAttachment,
} from "../composer-editor-mutations.ts";
import {
  handleComposerPaste,
  materializeTieredPlainPaste,
} from "../composer-paste.ts";
import { classifyPlainPaste } from "../structured-composer/paste-tiers.ts";

function persistableAttachments(
  attachments: ComposerAttachment[]
): NonNullable<TerminalDraftComposition["attachments"]> {
  return attachments.map(
    ({
      previewDataUrl: _previewDataUrl,
      previewHeight: _previewHeight,
      previewWidth: _previewWidth,
      ...attachment
    }) => attachment
  );
}

export function useTerminalComposerAttachments(input: {
  disabled: boolean;
  /**
   * Lexical-preserving mutations. When provided, attachment token edits go
   * through the editor so @ mention chips are not wiped by setValue.
   */
  editorMutations?: ComposerEditorMutations;
  getDraftAndCursor: () => {
    cursor: number;
    draft: string;
    selectionEnd?: number;
  };
  /** draft + optional caret for textarea selection restore */
  onDraftChange: (draft: string, cursor?: number) => void;
  reportError: (titleKey: string, detail: string) => void;
  session: TerminalComposerSession;
  t: (key: string) => string;
}): {
  attachments: ComposerAttachment[];
  buildPayloadOrReport: (draft: string) => string | null;
  canSendWithDraft: (draft: string) => boolean;
  onDragOver: (event: DragEvent) => void;
  onDrop: (event: DragEvent) => void;
  onLargePlainPaste: (text: string) => void;
  onPaste: (event: ClipboardEvent) => void;
  pickFiles: () => void;
  removeAttachment: (id: string) => void;
  revealPath: (path: string) => void;
  updatePasteContent: (id: string, text: string) => void;
} {
  const {
    disabled,
    editorMutations,
    getDraftAndCursor,
    onDraftChange,
    reportError: onError,
    session,
    t,
  } = input;
  const { panelId, signal } = session;
  const reportError = useCallback(
    (titleKey: string, detail: string) => {
      if (!signal.aborted) {
        onError(titleKey, detail);
      }
    },
    [onError, signal]
  );

  const subscribe = useCallback(
    (listener: () => void) => subscribeComposerSession(session, listener),
    [session]
  );

  const readAttachments = useCallback(
    (): ComposerAttachment[] => readComposerAttachments(session),
    [session]
  );
  const attachments = useSyncExternalStore(subscribe, readAttachments);

  const writeAttachments = useCallback(
    (next: ComposerAttachment[]) => {
      writeComposerAttachments(session, next);
      writeTerminalDraftComposition(panelId, {
        attachments: persistableAttachments(next),
      });
    },
    [panelId, session]
  );

  const enqueueMerge = useCallback(
    (task: () => void | Promise<void>) =>
      enqueueComposerAttachmentMerge(session, task),
    [session]
  );

  const canSendWithDraft = useCallback(
    (draft: string) =>
      !signal.aborted &&
      buildComposerSendText(readAttachments(), draft).length > 0,
    [readAttachments, signal]
  );

  const buildPayloadOrReport = useCallback(
    (draft: string): string | null => {
      if (signal.aborted) {
        return null;
      }
      const current = readAttachments();
      const invalid = editorMutations?.listInvalidAttachmentRefs(current) ?? [];
      if (invalid.length > 0) {
        reportError(
          "terminal.composer.invalidAttachmentRef",
          invalid.join(", ")
        );
        return null;
      }

      const payload = annotatePierCanvasInvokeLocale(
        buildComposerSendText(current, draft),
        resolveLanguagePreference(useLocaleStore.getState().language)
      );
      if (payload.length === 0) {
        return null;
      }
      if (payload.length > MAX_COMPOSER_SEND_TEXT_LENGTH) {
        reportError("terminal.composer.sendTooLong", String(payload.length));
        return null;
      }
      return payload;
    },
    [editorMutations, readAttachments, reportError, signal]
  );

  const removeAttachment = useCallback(
    (id: string) => {
      if (signal.aborted) {
        return;
      }
      removeComposerAttachment({
        editorMutations,
        getDraftAndCursor,
        onDraftChange,
        readAttachments,
        removeId: id,
        writeAttachments,
      });
    },
    [
      editorMutations,
      getDraftAndCursor,
      onDraftChange,
      readAttachments,
      signal,
      writeAttachments,
    ]
  );

  // Only this registration captures editor/view callbacks. Async jobs route by
  // session at delivery time, so a previous mount never edits a replacement.
  useEffect(
    () =>
      registerComposerEditHandler(session, (edit) => {
        if (signal.aborted) {
          return false;
        }
        try {
          const sync =
            edit.kind === "attachments"
              ? mergeComposerAttachments({
                  editorMutations,
                  getDraftAndCursor,
                  incoming: edit.attachments,
                  onDraftChange,
                  readAttachments,
                  writeAttachments,
                })
              : insertComposerPlainTextAtCursor({
                  editorMutations,
                  getDraftAndCursor,
                  onDraftChange,
                  text: edit.text,
                });
          return sync !== null;
        } catch (error: unknown) {
          reportError(
            "terminal.composer.attachFailed",
            error instanceof Error ? error.message : String(error)
          );
          return false;
        }
      }),
    [
      editorMutations,
      getDraftAndCursor,
      onDraftChange,
      readAttachments,
      reportError,
      session,
      signal,
      writeAttachments,
    ]
  );

  const mergeAttachments = useCallback(
    (incoming: readonly ComposerAttachment[]): boolean =>
      incoming.length > 0 &&
      dispatchComposerEdit(session, {
        attachments: incoming,
        kind: "attachments",
      }),
    [session]
  );

  const reportFailures = useCallback(
    (failures: readonly { path: string; reason: string }[]) => {
      if (failures.length === 0) {
        return;
      }
      reportError(
        "terminal.composer.attachFailed",
        failures.map((item) => `${item.path}: ${item.reason}`).join("\n")
      );
    },
    [reportError]
  );

  const resolveAndMerge = useCallback(
    async (paths: readonly string[]): Promise<boolean> => {
      if (signal.aborted || paths.length === 0) {
        return false;
      }
      let advanced = false;
      await enqueueMerge(async () => {
        try {
          const result = await window.pier.terminal.resolveComposerPaths([
            ...paths,
          ]);
          if (signal.aborted) {
            return;
          }
          reportFailures(result.failures);
          if (mergeAttachments(result.attachments.map(dtoToAttachment))) {
            advanced = true;
          }
        } catch (error: unknown) {
          reportError(
            "terminal.composer.attachFailed",
            error instanceof Error ? error.message : String(error)
          );
        }
      });
      return !signal.aborted && advanced;
    },
    [enqueueMerge, mergeAttachments, reportError, reportFailures, signal]
  );

  const collectFiles = useCallback(
    (files: FileList | File[]) =>
      collectComposerFiles({
        enqueueMerge,
        files,
        mergeAttachments,
        reportError,
        resolveAndMerge,
        signal,
      }),
    [enqueueMerge, mergeAttachments, reportError, resolveAndMerge, signal]
  );

  const pickFiles = useCallback(() => {
    if (disabled || signal.aborted) {
      return;
    }
    runTerminalDraftMutation(panelId, async () => {
      try {
        const pick = await window.pier.terminal.pickComposerFiles();
        if (signal.aborted) {
          return;
        }
        if (!pick.ok) {
          reportError("terminal.composer.attachFailed", pick.error);
          return;
        }
        await resolveAndMerge(pick.paths);
      } catch (error: unknown) {
        reportError(
          "terminal.composer.attachFailed",
          error instanceof Error ? error.message : String(error)
        );
      }
    }).catch(() => undefined);
  }, [disabled, panelId, reportError, resolveAndMerge, signal]);

  const insertPlainTextAtCursor = useCallback(
    (text: string) => {
      if (text !== "") {
        dispatchComposerEdit(session, { kind: "text", text });
      }
    },
    [session]
  );

  const onPaste = useCallback(
    (event: ClipboardEvent) => {
      runTerminalDraftMutation(panelId, () =>
        handleComposerPaste({
          collectFiles,
          disabled,
          dtoToAttachment,
          enqueueMerge,
          event,
          insertPlainTextAtCursor,
          mergeAttachments,
          reportError,
          signal,
        })
      ).catch(() => undefined);
    },
    [
      collectFiles,
      disabled,
      enqueueMerge,
      insertPlainTextAtCursor,
      mergeAttachments,
      panelId,
      reportError,
      signal,
    ]
  );

  const onLargePlainPaste = useCallback(
    (text: string) => {
      if (signal.aborted) {
        return;
      }
      const tier = classifyPlainPaste(text);
      if (tier === "small") {
        return;
      }
      runTerminalDraftMutation(panelId, () =>
        materializeTieredPlainPaste({
          disabled,
          enqueueMerge,
          insertPlainTextAtCursor,
          mergeAttachments,
          signal,
          t,
          text,
          tier,
        })
      ).catch(() => undefined);
    },
    [
      disabled,
      enqueueMerge,
      insertPlainTextAtCursor,
      mergeAttachments,
      panelId,
      signal,
      t,
    ]
  );

  const updatePasteContent = useCallback(
    (id: string, text: string) => {
      if (signal.aborted) {
        return;
      }
      const next = updatePasteAttachmentContent({
        attachments: readAttachments(),
        id,
        text,
      });
      writeAttachments(next);
    },
    [readAttachments, signal, writeAttachments]
  );

  const onDragOver = useCallback(
    (event: DragEvent) => {
      if (disabled || signal.aborted) {
        return;
      }
      if (
        Array.from(event.dataTransfer.items ?? []).some(
          (item) => item.kind === "file"
        )
      ) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }
    },
    [disabled, signal]
  );

  const onDrop = useCallback(
    (event: DragEvent) => {
      if (disabled || signal.aborted) {
        return;
      }
      // Always prevent default for file drops — browser would otherwise
      // navigate to the file/folder, breaking drag-and-drop attachment.
      const hasFile = Array.from(event.dataTransfer.items ?? []).some(
        (item) => item.kind === "file"
      );
      if (!hasFile) {
        return;
      }
      event.preventDefault();
      const files = event.dataTransfer.files;
      if (files != null && files.length > 0) {
        runTerminalDraftMutation(panelId, async () => {
          await collectFiles(files);
        }).catch(() => undefined);
      }
    },
    [collectFiles, disabled, panelId, signal]
  );

  const revealPath = useCallback((path: string) => {
    window.pier.terminal.revealComposerPath(path).catch(() => undefined);
  }, []);

  return {
    attachments,
    buildPayloadOrReport,
    canSendWithDraft,
    onDragOver,
    onDrop,
    onLargePlainPaste,
    onPaste,
    pickFiles,
    removeAttachment,
    revealPath,
    updatePasteContent,
  };
}
