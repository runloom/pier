import type { FilesDocumentPanelSource } from "./files-document-types.ts";
import type { FilesPanelTransferViewSeed } from "./files-panel-transfer-state.ts";

export interface FilesPanelTransferBookkeeping {
  createdTarget: boolean;
  originalDraftKey?: string;
  sourceDocumentId: string;
  targetDocumentId: string;
  targetDraftKey?: string;
  targetSource: FilesDocumentPanelSource;
  transferScope: { documentId: string; panelId: string } | null;
  view: FilesPanelTransferViewSeed;
}

const entries = new Map<string, FilesPanelTransferBookkeeping>();

export function rememberFilesPanelTransfer(
  transferId: string,
  entry: FilesPanelTransferBookkeeping
): void {
  entries.set(transferId, entry);
}

export function takeFilesPanelTransfer(
  transferId: string
): FilesPanelTransferBookkeeping | undefined {
  const entry = entries.get(transferId);
  entries.delete(transferId);
  return entry;
}

export function getFilesPanelTransfer(
  transferId: string
): FilesPanelTransferBookkeeping | undefined {
  return entries.get(transferId);
}

export function forgetFilesPanelTransfer(transferId: string): void {
  entries.delete(transferId);
}

export function clearFilesPanelTransferBookkeepingForTests(): void {
  entries.clear();
}
