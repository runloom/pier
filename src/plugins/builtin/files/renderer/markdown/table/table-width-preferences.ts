/**
 * Per-file markdown table column widths (reading preference).
 * Keyed by file path → structure key (column count + header texts) → column
 * index. Body-cell edits keep the key; structural edits invalidate stale
 * widths. Hand-written localStorage persistence mirrors preview-preferences.ts
 * (no zustand persist middleware anywhere in this plugin).
 */
export const TABLE_WIDTHS_CHANGED_EVENT =
  "pier:files:markdown-table-widths-changed";
export const TABLE_WIDTHS_STORAGE_PREFIX = "pier.files.markdown.tableWidths:";
export const TABLE_MIN_COLUMN_WIDTH_PX = 24;
/** 列宽硬顶：clamp 与 ARIA valuemax 同源（防 aria-valuenow 越过声明上限）。 */
export const TABLE_MAX_COLUMN_WIDTH_PX = 4096;

/** hash → (columnIndex → px) */
type FileWidths = Record<string, Record<string, number>>;

export function isTableWidthsStorageKey(
  key: string | null | undefined
): boolean {
  return Boolean(key?.startsWith(TABLE_WIDTHS_STORAGE_PREFIX));
}

function storageKey(sourcePath: string): string {
  return `${TABLE_WIDTHS_STORAGE_PREFIX}${sourcePath}`;
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
  return Math.min(
    TABLE_MAX_COLUMN_WIDTH_PX,
    Math.max(TABLE_MIN_COLUMN_WIDTH_PX, Math.round(widthPx))
  );
}

export function readTableWidths(
  sourcePath: string,
  widthsKey: string
): TableColumnWidths | null {
  const entry = readStorage(sourcePath)[widthsKey];
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
  widthsKey: string;
  columnIndex: number;
  widthPx: number;
}): void {
  writeTableColumnWidths({
    sourcePath: input.sourcePath,
    widthsKey: input.widthsKey,
    widths: { [String(input.columnIndex)]: input.widthPx },
  });
}

/**
 * 批量写多列宽度：一次写盘 + 一次变更事件。首次拖拽的「冻结全列快照」
 * 必须走这里，否则每列一次事件会触发 N 次镜像重渲染。
 */
export function writeTableColumnWidths(input: {
  sourcePath: string;
  widthsKey: string;
  widths: Record<string, number>;
}): void {
  const all = readStorage(input.sourcePath);
  const entry = { ...(all[input.widthsKey] ?? {}) };
  for (const [columnKey, widthPx] of Object.entries(input.widths)) {
    entry[columnKey] = clampColumnWidth(widthPx);
  }
  all[input.widthsKey] = entry;
  writeStorage(input.sourcePath, all);
}

export function resetTableWidths(sourcePath: string, widthsKey: string): void {
  const widths = readStorage(sourcePath);
  if (!(widthsKey in widths)) return;
  delete widths[widthsKey];
  writeStorage(sourcePath, widths);
}

export function resetTableColumnWidth(
  sourcePath: string,
  widthsKey: string,
  columnIndex: number
): void {
  const widths = readStorage(sourcePath);
  const entry = widths[widthsKey];
  if (!entry) return;
  delete entry[String(columnIndex)];
  if (Object.keys(entry).length === 0) {
    delete widths[widthsKey];
  } else {
    widths[widthsKey] = entry;
  }
  writeStorage(sourcePath, widths);
}
