export type FileSaveOutcome =
  | "cancelled"
  | "compare"
  | "failed"
  | "noop"
  | "saved";

export interface FileDocumentSettleResult {
  documentId: string;
  outcome: FileSaveOutcome;
}
