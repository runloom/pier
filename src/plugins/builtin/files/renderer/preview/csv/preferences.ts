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
  const raw = preferenceStorage()?.getItem(widthsKey(documentId, structureKey));
  if (!raw) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const widths: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        widths[key] = Math.round(value);
      }
    }
    return Object.keys(widths).length > 0 ? widths : null;
  } catch {
    return null;
  }
}

export function writeCsvColumnWidths(input: {
  documentId: string;
  structureKey: string;
  widths: Record<string, number>;
}): void {
  try {
    preferenceStorage()?.setItem(
      widthsKey(input.documentId, input.structureKey),
      JSON.stringify(input.widths)
    );
  } catch {
    // Preference persistence never breaks the grid.
  }
}
