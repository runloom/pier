/**
 * Cross-window panel transfer adapter for the Files file panel
 * (`pier.files.filePanel`).
 *
 * Draft body text never enters prepared state / journal. Recoverable drafts are
 * cloned to a transfer staging key (with `id` rewritten to the target document
 * identity), main copies staging→target, and the target renderer hydrates the
 * copied draft into the client store before ensuring the document.
 *
 * Registration lives in `files-panel-transfer-registration.ts`; this module
 * owns bookkeeping and re-exports shared helpers for that registration.
 */

import type {
  FilesPanelTransferPreparedState,
  FilesPanelTransferViewSeed,
} from "./files-panel-transfer-state.ts";

export type {
  FilesPanelTransferDeps,
  FilesPanelTransferViewCapture,
} from "./files-panel-transfer-deps.ts";
export {
  allocateTargetSource,
  captureViewSeed,
  needsDraftMigration,
  originalDraftKeyFor,
  remainingReferencesSource,
  rewritePersistedDraftId,
  serializeForStaging,
  targetDraftKeyFor,
} from "./files-panel-transfer-drafts.ts";
export {
  describeFilesPanelSourceParams,
  type FilesPanelTransferSourceResolution,
  logFilesPanelTransfer,
  resolveFilesPanelTransferSource,
} from "./files-panel-transfer-source.ts";

export interface TransferBookkeeping {
  createdTarget: boolean;
  originalDraftKey?: string;
  sourceDocumentId: string;
  targetDocumentId: string;
  targetDraftKey?: string;
  targetSource: FilesPanelTransferPreparedState["targetSource"];
  transferScope: { documentId: string; panelId: string } | null;
  view: FilesPanelTransferViewSeed;
}

const bookkeepingByTransferId = new Map<string, TransferBookkeeping>();

export function rememberBookkeeping(
  transferId: string,
  entry: TransferBookkeeping
): void {
  bookkeepingByTransferId.set(transferId, entry);
}

export function takeBookkeeping(
  transferId: string
): TransferBookkeeping | undefined {
  const entry = bookkeepingByTransferId.get(transferId);
  bookkeepingByTransferId.delete(transferId);
  return entry;
}

export function getBookkeeping(
  transferId: string
): TransferBookkeeping | undefined {
  return bookkeepingByTransferId.get(transferId);
}

export function forgetBookkeeping(transferId: string): void {
  bookkeepingByTransferId.delete(transferId);
}

export function clearFilesPanelTransferBookkeepingForTests(): void {
  bookkeepingByTransferId.clear();
}
