import type { TerminalComposerAttachmentDto } from "@shared/contracts/terminal.ts";
import type { ClipboardEvent } from "react";
import { showAppConfirm } from "@/stores/app-dialog.store.ts";
import { LARGE_PASTE_CHAR_THRESHOLD } from "./structured-composer/large-paste.ts";
import type { ComposerAttachment } from "./terminal-composer-attachments-model.ts";

export { LARGE_PASTE_CHAR_THRESHOLD } from "./structured-composer/large-paste.ts";

/**
 * Materialize a large plain-text paste as a .txt attachment (Phase B).
 * Owned by Lexical PastePlainTextPlugin so insert + attach cannot race.
 */
export function materializeLargePlainPaste(input: {
  disabled: boolean;
  dtoToAttachment: (dto: TerminalComposerAttachmentDto) => ComposerAttachment;
  enqueueMerge: (task: () => void | Promise<void>) => Promise<void>;
  insertPlainTextAtCursor: (
    text: string,
    base?: { cursor: number; draft: string }
  ) => void;
  mergeAttachments: (incoming: readonly ComposerAttachment[]) => boolean;
  t: (key: string) => string;
  text: string;
}): void {
  const {
    disabled,
    dtoToAttachment,
    enqueueMerge,
    insertPlainTextAtCursor,
    mergeAttachments,
    t,
    text,
  } = input;
  if (disabled || text.length < LARGE_PASTE_CHAR_THRESHOLD) {
    return;
  }
  (async () => {
    await enqueueMerge(async () => {
      try {
        const result = await window.pier.terminal.materializeComposerTextBytes({
          text,
        });
        if (!result.ok) {
          await offerLargePasteFallback({
            detail: result.error,
            insertPlainTextAtCursor,
            plain: text,
            t,
          });
          return;
        }
        if (result.attachment) {
          mergeAttachments([dtoToAttachment(result.attachment)]);
        }
      } catch (error: unknown) {
        await offerLargePasteFallback({
          detail: error instanceof Error ? error.message : String(error),
          insertPlainTextAtCursor,
          plain: text,
          t,
        });
      }
    });
  })().catch(() => undefined);
}

/** File / image clipboard pastes (plain text owned by Lexical plugin). */
export function handleComposerPaste(input: {
  collectFiles: (files: FileList | File[]) => Promise<boolean>;
  disabled: boolean;
  dtoToAttachment: (dto: TerminalComposerAttachmentDto) => ComposerAttachment;
  enqueueMerge: (task: () => void | Promise<void>) => Promise<void>;
  event: ClipboardEvent;
  insertPlainTextAtCursor: (
    text: string,
    base?: { cursor: number; draft: string }
  ) => void;
  mergeAttachments: (incoming: readonly ComposerAttachment[]) => boolean;
  reportError: (titleKey: string, detail: string) => void;
}): void {
  const {
    collectFiles,
    disabled,
    dtoToAttachment,
    enqueueMerge,
    event,
    insertPlainTextAtCursor,
    mergeAttachments,
    reportError,
  } = input;

  if (disabled) {
    return;
  }

  const { clipboardData } = event;
  const files = clipboardData.files;
  const hasFiles = files != null && files.length > 0;
  const hasImageItem = Array.from(clipboardData.items ?? []).some(
    (item) => item.kind === "file" && item.type.startsWith("image/")
  );
  const plain = clipboardData.getData("text/plain");

  if (!(hasFiles || hasImageItem)) {
    // Plain text (including large paste) is handled by PastePlainTextPlugin.
    return;
  }

  event.preventDefault();

  (async () => {
    if (hasFiles) {
      await collectFiles(files);
    } else if (hasImageItem) {
      await enqueueMerge(async () => {
        try {
          const result =
            await window.pier.terminal.materializeComposerClipboardImage();
          if (!result.ok) {
            reportError("terminal.composer.attachFailed", result.error);
            return;
          }
          if (result.attachment) {
            mergeAttachments([dtoToAttachment(result.attachment)]);
          }
        } catch (error: unknown) {
          reportError(
            "terminal.composer.attachFailed",
            error instanceof Error ? error.message : String(error)
          );
        }
      });
    }

    if (plain) {
      // Never pass `base` string rewrite here — that flattens Lexical chips via
      // setValue. Always insert through editorMutations when available.
      insertPlainTextAtCursor(plain);
    }
  })().catch(() => undefined);
}

async function offerLargePasteFallback(input: {
  detail: string;
  insertPlainTextAtCursor: (
    text: string,
    base?: { cursor: number; draft: string }
  ) => void;
  plain: string;
  t: (key: string) => string;
}): Promise<void> {
  const { detail, insertPlainTextAtCursor, plain, t } = input;
  const confirmed = await showAppConfirm({
    body: detail,
    confirmLabel: t("terminal.composer.pasteInsertAnyway"),
    intent: "default",
    size: "default",
    title: t("terminal.composer.largePasteAttachFailed"),
  });
  if (confirmed) {
    insertPlainTextAtCursor(plain);
  }
}
