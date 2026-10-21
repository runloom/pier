export type CsvOpenMode = "preview" | "source";

export const CSV_OPEN_MODE_KEY = "pier.files.csv.openMode";

function preferenceStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Delimited text opens as a table; the source toggle is remembered. */
export function readCsvOpenMode(): CsvOpenMode {
  return preferenceStorage()?.getItem(CSV_OPEN_MODE_KEY) === "source"
    ? "source"
    : "preview";
}

export function writeCsvOpenMode(mode: CsvOpenMode): void {
  preferenceStorage()?.setItem(CSV_OPEN_MODE_KEY, mode);
}
