import {
  readStoredColumnWidths,
  writeStoredColumnWidths,
} from "../shared/preferences.ts";
import type { CsvDelimiter } from "./parser.ts";

export interface CsvFileSettings {
  delimiter: CsvDelimiter | "auto";
  header: boolean;
}

const SETTINGS_PREFIX = "pier.files.csv.settings.v1:";
const WIDTHS_PREFIX = "pier.files.csv.columnWidths.v1:";

function preferenceStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function settingsKey(documentId: string): string {
  return `${SETTINGS_PREFIX}${documentId}`;
}

function widthsKey(documentId: string, structureKey: string): string {
  return `${WIDTHS_PREFIX}${documentId}:${structureKey}`;
}

export function readCsvSettings(documentId: string): CsvFileSettings {
  const raw = preferenceStorage()?.getItem(settingsKey(documentId));
  if (!raw) {
    return { delimiter: "auto", header: true };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return { delimiter: "auto", header: true };
    }
    const record = parsed as Record<string, unknown>;
    const delimiter =
      record.delimiter === "," ||
      record.delimiter === "\t" ||
      record.delimiter === ";" ||
      record.delimiter === "|"
        ? record.delimiter
        : "auto";
    return { delimiter, header: record.header !== false };
  } catch {
    return { delimiter: "auto", header: true };
  }
}

export function writeCsvSettings(
  documentId: string,
  settings: CsvFileSettings
): void {
  try {
    preferenceStorage()?.setItem(
      settingsKey(documentId),
      JSON.stringify(settings)
    );
  } catch {
    // Preferences degrade to session-only when storage is unavailable.
  }
}

export function csvColumnStructureKey(
  columnCount: number,
  headerLabels: readonly string[]
): string {
  return `${columnCount}:${headerLabels.join("\u001f")}`;
}

export function readCsvColumnWidths(
  documentId: string,
  structureKey: string
): Record<string, number> | null {
  return readStoredColumnWidths(widthsKey(documentId, structureKey));
}

export function writeCsvColumnWidths(input: {
  documentId: string;
  structureKey: string;
  widths: Record<string, number>;
}): void {
  writeStoredColumnWidths(
    widthsKey(input.documentId, input.structureKey),
    input.widths
  );
}
