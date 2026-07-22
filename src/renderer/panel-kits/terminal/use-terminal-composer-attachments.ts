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
  MAX_COMPOSER_SEND_TEXT_LENGTH,
} from "./terminal-composer-attachments-model.ts";
import {
  type ComposerEditorMutations,
  insertComposerPlainTextAtCursor,
  mergeComposerAttachments,
  removeComposerAttachment,
} from "./terminal-composer-editor-mutations.ts";
import {
  handleComposerPaste,
  materializeLargePlainPaste,
} from "./terminal-composer-paste.ts";

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
  panelId: string;
  reportError: (titleKey: string, detail: string) => void;
  t: (key: string) => string;
}): {
  attachments: ComposerAttachment[];
  buildPayloadOrReport: (draft: string) => string | null;
  canSendWithDraft: (draft: string) => boolean;
  clearAll: () => void;
  hydrateFromMaps: () => void;
  onDragOver: (event: DragEvent) => void;
  onDrop: (event: DragEvent) => void;
  onLargePlainPaste: (text: string) => void;
  onPaste: (event: ClipboardEvent) => void;
  pickFiles: () => void;
  removeAttachment: (id: string) => void;
  revealPath: (path: string) => void;
} {
  const {
    disabled,
    editorMutations,
    getDraftAndCursor,
    onDraftChange,
    panelId,
    reportError,
    t,
  } = input;

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
      const invalid = editorMutations?.listInvalidAttachmentRefs(current) ?? [];
      if (invalid.length > 0) {
        reportError(
          "terminal.composer.invalidAttachmentRef",
          invalid.join(", ")
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
    [editorMutations, readAttachments, reportError]
  );

  const removeAttachment = useCallback(
    (id: string) => {
      const sync = removeComposerAttachment({
        editorMutations,
        getDraftAndCursor,
        onDraftChange,
        readAttachments,
        removeId: id,
        writeAttachments,
      });
      if (sync) {
        syncDraftRef.current = sync;
      }
    },
    [
      editorMutations,
      getDraftAndCursor,
      onDraftChange,
      readAttachments,
      writeAttachments,
    ]
  );

  const mergeAttachments = useCallback(
    (incoming: readonly ComposerAttachment[]): boolean => {
      const sync = mergeComposerAttachments({
        editorMutations,
        getDraftAndCursor,
        incoming,
        onDraftChange,
        readAttachments,
        writeAttachments,
      });
      if (!sync) {
        return false;
      }
      mergeGenRef.current += 1;
      syncDraftRef.current = sync;
      return true;
    },
    [
      editorMutations,
      getDraftAndCursor,
      onDraftChange,
      readAttachments,
      writeAttachments,
    ]
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
      const sync = insertComposerPlainTextAtCursor({
        ...(base ? { base } : {}),
        editorMutations,
        getDraftAndCursor,
        onDraftChange,
        text,
      });
      if (sync) {
        syncDraftRef.current = sync;
      }
    },
    [editorMutations, getDraftAndCursor, onDraftChange]
  );

  const onPaste = useCallback(
    (event: ClipboardEvent) => {
      handleComposerPaste({
        collectFiles,
        disabled,
        dtoToAttachment,
        enqueueMerge,
        event,
        insertPlainTextAtCursor,
        mergeAttachments,
        reportError,
      });
    },
    [
      collectFiles,
      disabled,
      insertPlainTextAtCursor,
      mergeAttachments,
      reportError,
    ]
  );

  const onLargePlainPaste = useCallback(
    (text: string) => {
      materializeLargePlainPaste({
        disabled,
        dtoToAttachment,
        enqueueMerge,
        insertPlainTextAtCursor,
        mergeAttachments,
        t,
        text,
      });
    },
    [disabled, insertPlainTextAtCursor, mergeAttachments, t]
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
    onLargePlainPaste,
    onPaste,
    pickFiles,
    removeAttachment,
    revealPath,
  };
}
