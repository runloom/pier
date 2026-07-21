import type { TerminalComposerAttachmentDto } from "@shared/contracts/terminal.ts";
import {
  type ClipboardEvent,
  type DragEvent,
  useCallback,
  useRef,
  useState,
} from "react";
import {
  buildComposerSendText,
  type ComposerAttachment,
  findInvalidAttachmentTokens,
  insertPlainTextAtSelection,
  insertTokenAtCursor,
  MAX_COMPOSER_SEND_TEXT_LENGTH,
  removeAttachmentAndRewriteDraft,
} from "./terminal-composer-attachments-model.ts";

const attachmentsByPanel = new Map<string, ComposerAttachment[]>();

/** Serialize attach merges so concurrent pick/drop/paste cannot clobber Map. */
let mergeChain: Promise<void> = Promise.resolve();

function enqueueMerge(task: () => void | Promise<void>): Promise<void> {
  const run = mergeChain.then(task, task);
  mergeChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export function resetTerminalComposerAttachmentsForTests(): void {
  attachmentsByPanel.clear();
  mergeChain = Promise.resolve();
}

function dtoToAttachment(
  dto: TerminalComposerAttachmentDto
): ComposerAttachment {
  return {
    id: dto.id,
    kind: dto.kind,
    name: dto.name,
    path: dto.path,
    ...(dto.isDirectory ? { isDirectory: dto.isDirectory } : {}),
    ...(dto.previewDataUrl ? { previewDataUrl: dto.previewDataUrl } : {}),
  };
}

export function useTerminalComposerAttachments(input: {
  disabled: boolean;
  getDraftAndCursor: () => {
    cursor: number;
    draft: string;
    selectionEnd?: number;
  };
  /** draft + optional caret for textarea selection restore */
  onDraftChange: (draft: string, cursor?: number) => void;
  panelId: string;
  reportError: (titleKey: string, detail: string) => void;
}): {
  attachments: ComposerAttachment[];
  buildPayloadOrReport: (draft: string) => string | null;
  canSendWithDraft: (draft: string) => boolean;
  clearAll: () => void;
  hydrateFromMaps: () => void;
  onDragOver: (event: DragEvent) => void;
  onDrop: (event: DragEvent) => void;
  onPaste: (event: ClipboardEvent) => void;
  pickFiles: () => void;
  removeAttachment: (id: string) => void;
  revealPath: (path: string) => void;
} {
  const { disabled, getDraftAndCursor, onDraftChange, panelId, reportError } =
    input;

  const syncDraftRef = useRef<{ cursor: number; draft: string }>({
    cursor: 0,
    draft: "",
  });
  /** Bumps only when mergeAttachments actually appends tokens. */
  const mergeGenRef = useRef(0);

  const [attachments, setAttachments] = useState<ComposerAttachment[]>(
    () => attachmentsByPanel.get(panelId) ?? []
  );

  const readAttachments = useCallback(
    (): ComposerAttachment[] => attachmentsByPanel.get(panelId) ?? [],
    [panelId]
  );

  const writeAttachments = useCallback(
    (next: ComposerAttachment[]) => {
      if (next.length === 0) {
        attachmentsByPanel.delete(panelId);
      } else {
        attachmentsByPanel.set(panelId, next);
      }
      setAttachments(next);
    },
    [panelId]
  );

  const hydrateFromMaps = useCallback(() => {
    setAttachments(attachmentsByPanel.get(panelId) ?? []);
  }, [panelId]);

  const clearAll = useCallback(() => {
    attachmentsByPanel.delete(panelId);
    setAttachments([]);
  }, [panelId]);

  const canSendWithDraft = useCallback(
    (draft: string) =>
      buildComposerSendText(readAttachments(), draft).length > 0,
    [readAttachments]
  );

  const buildPayloadOrReport = useCallback(
    (draft: string): string | null => {
      const current = readAttachments();
      const invalid = findInvalidAttachmentTokens(draft, current.length);
      if (invalid.length > 0) {
        reportError(
          "terminal.composer.invalidAttachmentRef",
          invalid.map((n) => `[#${n}]`).join(", ")
        );
        return null;
      }

      const payload = buildComposerSendText(current, draft);
      if (payload.length === 0) {
        return null;
      }
      if (payload.length > MAX_COMPOSER_SEND_TEXT_LENGTH) {
        reportError("terminal.composer.sendTooLong", String(payload.length));
        return null;
      }
      return payload;
    },
    [readAttachments, reportError]
  );

  const removeAttachment = useCallback(
    (id: string) => {
      const current = readAttachments();
      const { draft } = getDraftAndCursor();
      const next = removeAttachmentAndRewriteDraft({
        attachments: current,
        draft,
        removeId: id,
      });
      writeAttachments(next.attachments);
      if (next.draft !== draft) {
        syncDraftRef.current = { cursor: next.draft.length, draft: next.draft };
        onDraftChange(next.draft);
      }
    },
    [getDraftAndCursor, onDraftChange, readAttachments, writeAttachments]
  );

  const mergeAttachments = useCallback(
    (incoming: readonly ComposerAttachment[]): boolean => {
      if (incoming.length === 0) {
        return false;
      }

      const current = readAttachments();
      const existingPaths = new Set(current.map((item) => item.path));
      const unique: ComposerAttachment[] = [];
      for (const item of incoming) {
        if (existingPaths.has(item.path)) {
          continue;
        }
        existingPaths.add(item.path);
        unique.push(item);
      }
      if (unique.length === 0) {
        return false;
      }

      const snapshot = getDraftAndCursor();
      let cursor = snapshot.cursor;
      let selectionEnd = snapshot.selectionEnd ?? snapshot.cursor;
      let draft = snapshot.draft;
      const next = [...current];
      for (const attachment of unique) {
        next.push(attachment);
        const inserted = insertTokenAtCursor(
          draft,
          cursor,
          next.length,
          selectionEnd
        );
        cursor = inserted.cursor;
        selectionEnd = inserted.cursor;
        draft = inserted.draft;
      }

      writeAttachments(next);
      mergeGenRef.current += 1;
      syncDraftRef.current = { cursor, draft };
      onDraftChange(draft, cursor);
      return true;
    },
    [getDraftAndCursor, onDraftChange, readAttachments, writeAttachments]
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
      if (paths.length === 0) {
        return false;
      }
      let advanced = false;
      await enqueueMerge(async () => {
        try {
          const result = await window.pier.terminal.resolveComposerPaths([
            ...paths,
          ]);
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
      return advanced;
    },
    [mergeAttachments, reportError, reportFailures]
  );

  const materializeImageFile = useCallback(
    async (file: File): Promise<boolean> => {
      let advanced = false;
      await enqueueMerge(async () => {
        try {
          const buffer = await file.arrayBuffer();
          const result =
            await window.pier.terminal.materializeComposerImageBytes({
              bytes: new Uint8Array(buffer),
              ...(file.type ? { mime: file.type } : {}),
              ...(file.name ? { name: file.name } : {}),
            });
          if (!result.ok) {
            reportError("terminal.composer.attachFailed", result.error);
            return;
          }
          if (
            result.attachment &&
            mergeAttachments([dtoToAttachment(result.attachment)])
          ) {
            advanced = true;
          }
        } catch (error: unknown) {
          reportError(
            "terminal.composer.attachFailed",
            error instanceof Error ? error.message : String(error)
          );
        }
      });
      return advanced;
    },
    [mergeAttachments, reportError]
  );
  const collectFiles = useCallback(
    async (files: FileList | File[]): Promise<boolean> => {
      let advanced = false;
      const list = Array.from(files);
      const paths: string[] = [];
      const pathlessImages: File[] = [];

      for (const file of list) {
        // Electron sandbox mode does not expose File.path; use the preload
        // bridge (webUtils.getPathForFile) to resolve the absolute path.
        let path = (file as File & { path?: string }).path;
        if (typeof path !== "string" || path.length === 0) {
          try {
            path = window.pier.terminal.getPathForFile(file);
          } catch {
            path = undefined;
          }
        }
        if (typeof path === "string" && path.length > 0) {
          paths.push(path);
          continue;
        }
        if (file.type.startsWith("image/")) {
          pathlessImages.push(file);
        }
        // Silently skip pathless non-image items — Electron may not expose
        // file.path for all drop types (e.g. .app bundles, some folders).
      }

      if (await resolveAndMerge(paths)) {
        advanced = true;
      }
      for (const image of pathlessImages) {
        if (await materializeImageFile(image)) {
          advanced = true;
        }
      }
      return advanced;
    },
    [materializeImageFile, resolveAndMerge]
  );

  const pickFiles = useCallback(() => {
    if (disabled) {
      return;
    }
    (async () => {
      try {
        const pick = await window.pier.terminal.pickComposerFiles();
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
    })().catch(() => undefined);
  }, [disabled, reportError, resolveAndMerge]);

  const insertPlainTextAtCursor = useCallback(
    (text: string, base?: { cursor: number; draft: string }) => {
      if (text === "") {
        return;
      }
      const live = getDraftAndCursor();
      const source = base ?? {
        cursor: live.cursor,
        draft: live.draft,
      };
      const selectionEnd = base
        ? base.cursor
        : (live.selectionEnd ?? live.cursor);
      const inserted = insertPlainTextAtSelection(
        source.draft,
        source.cursor,
        base ? base.cursor : selectionEnd,
        text
      );
      syncDraftRef.current = {
        cursor: inserted.cursor,
        draft: inserted.draft,
      };
      onDraftChange(inserted.draft, inserted.cursor);
    },
    [getDraftAndCursor, onDraftChange]
  );

  const onPaste = useCallback(
    (event: ClipboardEvent) => {
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
        return;
      }

      event.preventDefault();

      (async () => {
        // `advanced` is only true when THIS paste's own merge appended tokens.
        // Returned from collectFiles / inline merge — no global gen comparison.
        let advanced = false;
        if (hasFiles) {
          advanced = await collectFiles(files);
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
                advanced = mergeAttachments([
                  dtoToAttachment(result.attachment),
                ]);
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
          const base = advanced ? syncDraftRef.current : undefined;
          insertPlainTextAtCursor(plain, base);
        }
      })().catch(() => undefined);
    },
    [
      collectFiles,
      disabled,
      insertPlainTextAtCursor,
      mergeAttachments,
      reportError,
    ]
  );

  const onDragOver = useCallback(
    (event: DragEvent) => {
      if (disabled) {
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
    [disabled]
  );

  const onDrop = useCallback(
    (event: DragEvent) => {
      if (disabled) {
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
        collectFiles(files).catch(() => undefined);
      }
    },
    [collectFiles, disabled]
  );

  const revealPath = useCallback((path: string) => {
    window.pier.terminal.revealComposerPath(path).catch(() => undefined);
  }, []);

  return {
    attachments,
    buildPayloadOrReport,
    canSendWithDraft,
    clearAll,
    hydrateFromMaps,
    onDragOver,
    onDrop,
    onPaste,
    pickFiles,
    removeAttachment,
    revealPath,
  };
}
