import {
  type FileDocumentFormat,
  type FileDocumentWriteResult,
  type FileWritableDocumentEol,
  fileDocumentFormatSchema,
  fileDocumentWriteResultSchema,
  fileWritableDocumentEolSchema,
  fileWriteCommitReceiptStorageKey,
} from "@shared/contracts/file.ts";
import {
  type FileSaveTarget,
  fileSaveTargetSchema,
} from "@shared/contracts/file-save-target.ts";
import { z } from "zod";
import { SAVE_AS_OPERATION_STORAGE_PREFIX } from "./files-document-draft-records.ts";
import {
  listFilesDraftRecords,
  persistFilesDraftRecord,
  readFilesDraftRecord,
  removeFilesDraftRecord,
} from "./files-document-drafts.ts";
import {
  type FilesDocumentPanelSource,
  filesDocumentPanelSourceSchema,
} from "./files-document-types.ts";

const saveAsJournalSchema = z.object({
  eol: fileWritableDocumentEolSchema,
  format: fileDocumentFormatSchema,
  operationId: z.string().min(1),
  panelGroupId: z.string().min(1).optional(),
  panelId: z.string().min(1).optional(),
  phase: z.enum(["prepared", "written"]),
  savedContents: z.string(),
  source: filesDocumentPanelSourceSchema,
  sourceDocumentId: z.string().min(1),
  target: fileSaveTargetSchema,
  writtenResult: fileDocumentWriteResultSchema.optional(),
});

export interface SaveAsJournalRecord {
  eol: FileWritableDocumentEol;
  format: FileDocumentFormat;
  operationId: string;
  panelGroupId?: string;
  panelId?: string;
  phase: "prepared" | "written";
  savedContents: string;
  source: FilesDocumentPanelSource;
  sourceDocumentId: string;
  target: FileSaveTarget;
  writtenResult?: Extract<FileDocumentWriteResult, { kind: "written" }>;
}

function journalKey(sourceDocumentId: string): string {
  return `${SAVE_AS_OPERATION_STORAGE_PREFIX}${encodeURIComponent(sourceDocumentId)}`;
}

function parseJournal(raw: string): SaveAsJournalRecord | null {
  const parsedJson: unknown = JSON.parse(raw);
  const parsed = saveAsJournalSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return null;
  }
  if (
    parsed.data.phase === "written" &&
    parsed.data.writtenResult?.kind !== "written"
  ) {
    return null;
  }
  return parsed.data as SaveAsJournalRecord;
}

export function createSaveAsJournal(input: {
  eol: FileWritableDocumentEol;
  format: FileDocumentFormat;
  panelGroupId?: string;
  panelId?: string;
  savedContents: string;
  source: FilesDocumentPanelSource;
  sourceDocumentId: string;
  target: FileSaveTarget;
}): SaveAsJournalRecord {
  const record: SaveAsJournalRecord = {
    ...input,
    operationId: globalThis.crypto.randomUUID(),
    phase: "prepared",
  };
  persistFilesDraftRecord(
    journalKey(record.sourceDocumentId),
    JSON.stringify(record)
  );
  return record;
}

export function markSaveAsJournalWritten(
  record: SaveAsJournalRecord,
  writtenResult: Extract<FileDocumentWriteResult, { kind: "written" }>
): SaveAsJournalRecord {
  const written: SaveAsJournalRecord = {
    ...record,
    phase: "written",
    writtenResult,
  };
  persistFilesDraftRecord(
    journalKey(record.sourceDocumentId),
    JSON.stringify(written)
  );
  return written;
}

export function removeSaveAsJournal(record: SaveAsJournalRecord): void {
  removeFilesDraftRecord(journalKey(record.sourceDocumentId));
  removeFilesDraftRecord(fileWriteCommitReceiptStorageKey(record.operationId));
}

export function saveAsWriteReceipt(
  record: SaveAsJournalRecord
): Extract<FileDocumentWriteResult, { kind: "written" }> | null {
  const raw = readFilesDraftRecord(
    fileWriteCommitReceiptStorageKey(record.operationId)
  );
  if (!raw) {
    return null;
  }
  try {
    const parsed = fileDocumentWriteResultSchema.safeParse(JSON.parse(raw));
    return parsed.success && parsed.data.kind === "written"
      ? parsed.data
      : null;
  } catch {
    return null;
  }
}

export function saveAsJournalForDocument(
  documentId: string
): SaveAsJournalRecord | null {
  for (const key of listFilesDraftRecords(SAVE_AS_OPERATION_STORAGE_PREFIX)) {
    const raw = readFilesDraftRecord(key);
    if (!raw) {
      continue;
    }
    try {
      const record = parseJournal(raw);
      if (record?.sourceDocumentId === documentId) {
        return record;
      }
      if (!record) {
        removeFilesDraftRecord(key);
      }
    } catch {
      removeFilesDraftRecord(key);
    }
  }
  return null;
}
