/**
 * Per-file markdown table column widths (reading preference).
 * Keyed by file path → block content hash → column index, so edits to the
 * table invalidate stale widths automatically. Hand-written localStorage
 * persistence mirrors the preview-preferences.ts convention (no zustand
 * persist middleware anywhere in this plugin).
 */
export const TABLE_WIDTHS_CHANGED_EVENT =
  "pier:files:markdown-table-widths-changed";
export const TABLE_MIN_COLUMN_WIDTH_PX = 24;

const STORAGE_PREFIX = "pier.files.markdown.tableWidths:";
/** hash → (columnIndex → px) */
type FileWidths = Record<string, Record<string, number>>;

function storageKey(sourcePath: string): string {
  return `${STORAGE_PREFIX}${sourcePath}`;
}

function readStorage(sourcePath: string): FileWidths {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey(sourcePath));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as FileWidths) : {};
  } catch {
    return {};
  }
}

function writeStorage(sourcePath: string, widths: FileWidths): void {
  try {
    globalThis.localStorage?.setItem(
      storageKey(sourcePath),
      JSON.stringify(widths)
    );
  } catch {
    // Storage unavailable/quota: preference degrades to session-only no-op.
  }
  window.dispatchEvent(new CustomEvent(TABLE_WIDTHS_CHANGED_EVENT));
}

export function clampColumnWidth(widthPx: number): number {
  if (!Number.isFinite(widthPx)) return TABLE_MIN_COLUMN_WIDTH_PX;
  return Math.max(TABLE_MIN_COLUMN_WIDTH_PX, Math.round(widthPx));
}

export function readTableWidths(
  sourcePath: string,
  contentHash: string
): TableColumnWidths | null {
  const entry = readStorage(sourcePath)[contentHash];
  if (!entry || Object.keys(entry).length === 0) return null;
  // 读路径校验：手改/漂移的存储值（非有限数字）不进 colgroup/拖拽基线。
  const validated: TableColumnWidths = {};
  for (const [key, value] of Object.entries(entry)) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      validated[key] = value;
    }
  }
  return Object.keys(validated).length > 0 ? validated : null;
}

export type TableColumnWidths = Record<string, number>;

export function writeTableColumnWidth(input: {
  sourcePath: string;
  contentHash: string;
  columnIndex: number;
  widthPx: number;
}): void {
  const widths = readStorage(input.sourcePath);
  const entry = widths[input.contentHash] ?? {};
  entry[String(input.columnIndex)] = clampColumnWidth(input.widthPx);
  widths[input.contentHash] = entry;
  writeStorage(input.sourcePath, widths);
}

export function resetTableWidths(
  sourcePath: string,
  contentHash: string
): void {
  const widths = readStorage(sourcePath);
  if (!(contentHash in widths)) return;
  delete widths[contentHash];
  writeStorage(sourcePath, widths);
}

export function resetTableColumnWidth(
  sourcePath: string,
  contentHash: string,
  columnIndex: number
): void {
  const widths = readStorage(sourcePath);
  const entry = widths[contentHash];
  if (!entry) return;
  delete entry[String(columnIndex)];
  if (Object.keys(entry).length === 0) {
    delete widths[contentHash];
  } else {
    widths[contentHash] = entry;
  }
  writeStorage(sourcePath, widths);
}
