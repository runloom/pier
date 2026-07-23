import { z } from "zod";
import {
  type FilesDocumentPanelSource,
  type FileViewMode,
  filesDocumentPanelSourceSchema,
} from "./files-document-types.ts";

export const filesPanelTransferSelectionSchema = z
  .object({
    anchor: z.number().int().nonnegative(),
    head: z.number().int().nonnegative(),
  })
  .strict();

export const filesPanelTransferScrollSchema = z
  .object({
    left: z.number(),
    top: z.number(),
  })
  .strict();

export const filesPanelTransferViewSchema = z
  .object({
    // Legacy transfer payloads may still carry "rich"; coerce to source.
    mode: z.preprocess(
      (value) => (value === "rich" ? "source" : value),
      z.enum(["diff", "preview", "source"])
    ),
    selection: filesPanelTransferSelectionSchema.optional(),
    scroll: filesPanelTransferScrollSchema.optional(),
  })
  .strict();

/**
 * Prepared transfer state. Intentionally excludes document body text — drafts
 * travel via staged draft keys, not this descriptor.
 */
export const filesPanelTransferPreparedStateSchema = z
  .object({
    originalDraftKey: z.string().min(1).optional(),
    sourceDocumentId: z.string().min(1),
    targetDocumentId: z.string().min(1),
    targetSource: filesDocumentPanelSourceSchema,
    view: filesPanelTransferViewSchema,
  })
  .strict()
  .superRefine((state, context) => {
    const record = state as Record<string, unknown>;
    for (const forbidden of [
      "body",
      "contents",
      "currentContents",
      "savedContents",
      "conflictDiskContents",
    ]) {
      if (forbidden in record) {
        context.addIssue({
          code: "custom",
          message: `prepared state must not include ${forbidden}`,
          path: [forbidden],
        });
      }
    }
  });

export type FilesPanelTransferPreparedState = z.infer<
  typeof filesPanelTransferPreparedStateSchema
>;

export type FilesPanelTransferViewSeed = z.infer<
  typeof filesPanelTransferViewSchema
>;

const viewSeedsByPanelId = new Map<string, FilesPanelTransferViewSeed>();
const viewSeedsByDocumentId = new Map<string, FilesPanelTransferViewSeed>();
const panelModes = new Map<string, FileViewMode>();

type ViewSeedListener = (input: {
  documentId?: string;
  panelId: string;
  view: FilesPanelTransferViewSeed;
}) => void;

const viewSeedListeners = new Set<ViewSeedListener>();

export function rememberFilesPanelViewMode(
  panelId: string,
  mode: FileViewMode
): void {
  panelModes.set(panelId, mode);
}

export function readFilesPanelViewMode(panelId: string): FileViewMode {
  return panelModes.get(panelId) ?? "source";
}

export function clearFilesPanelViewMode(panelId: string): void {
  panelModes.delete(panelId);
}

export function seedFilesPanelView(input: {
  documentId?: string;
  panelId: string;
  view: FilesPanelTransferViewSeed;
}): void {
  viewSeedsByPanelId.set(input.panelId, input.view);
  if (input.documentId) {
    viewSeedsByDocumentId.set(input.documentId, input.view);
  }
  for (const listener of viewSeedListeners) {
    listener(input);
  }
}

/** Notify when a transfer view seed is written (including late seeds). */
export function subscribeFilesPanelViewSeed(
  listener: ViewSeedListener
): () => void {
  viewSeedListeners.add(listener);
  return () => {
    viewSeedListeners.delete(listener);
  };
}

/**
 * Consume a one-shot view seed for the target panel (mode/selection/scroll).
 * Prefers panelId, then documentId.
 */
export function takeFilesPanelViewSeed(input: {
  documentId?: string;
  panelId?: string;
}): FilesPanelTransferViewSeed | null {
  if (input.panelId) {
    const byPanel = viewSeedsByPanelId.get(input.panelId);
    if (byPanel) {
      viewSeedsByPanelId.delete(input.panelId);
      if (input.documentId) {
        viewSeedsByDocumentId.delete(input.documentId);
      }
      return byPanel;
    }
  }
  if (input.documentId) {
    const byDocument = viewSeedsByDocumentId.get(input.documentId);
    if (byDocument) {
      viewSeedsByDocumentId.delete(input.documentId);
      return byDocument;
    }
  }
  return null;
}

export function peekFilesPanelViewSeed(input: {
  documentId?: string;
  panelId?: string;
}): FilesPanelTransferViewSeed | null {
  if (input.panelId) {
    const byPanel = viewSeedsByPanelId.get(input.panelId);
    if (byPanel) {
      return byPanel;
    }
  }
  if (input.documentId) {
    return viewSeedsByDocumentId.get(input.documentId) ?? null;
  }
  return null;
}

export function clearFilesPanelTransferViewSeedsForTests(): void {
  viewSeedsByPanelId.clear();
  viewSeedsByDocumentId.clear();
  panelModes.clear();
  viewSeedListeners.clear();
}

export function parseFilesPanelTransferPreparedState(
  value: unknown
): FilesPanelTransferPreparedState | null {
  const parsed = filesPanelTransferPreparedStateSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function panelSourceIdentityKey(
  source: FilesDocumentPanelSource
): string {
  if (source.kind === "untitled") {
    return `untitled:${source.id}`;
  }
  const documentId = source.documentId ?? `${source.root}\0${source.path}`;
  return `disk:${documentId}`;
}
