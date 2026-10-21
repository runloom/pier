import { create } from "zustand";
import type { CsvDelimiter } from "./parser.ts";

export interface CsvHeaderEntry {
  canRedo: boolean;
  canUndo: boolean;
  columnCount: number;
  deleteActiveColumn(): void;
  deleteActiveRow(): void;
  /** `auto` keeps extension/content detection. */
  delimiter: CsvDelimiter | "auto";
  editable: boolean;
  hasActiveCell: boolean;
  header: boolean;
  insertColumnLeft(): void;
  insertColumnRight(): void;
  insertRowAbove(): void;
  insertRowBelow(): void;
  /** Large file: the grid is read-only but the file itself is writable. */
  previewOnly: boolean;
  redo(): void;
  rowCount: number;
  setDelimiter(delimiter: CsvDelimiter | "auto"): void;
  setHeader(header: boolean): void;
  undo(): void;
}

interface CsvHeaderState {
  entries: Record<string, CsvHeaderEntry | undefined>;
  register(key: string, entry: CsvHeaderEntry): void;
  unregister(key: string): void;
}

export function csvHeaderPanelKey(
  panelId: string | undefined,
  documentId: string
): string {
  return panelId ?? documentId;
}

/**
 * The CSV grid lives below the panel header, but its controls belong in the
 * same top chrome as language/encoding/view. The preview registers its editor
 * actions here; `CsvHeaderActions` renders them in `FilePanelActions`.
 */
export const useCsvHeaderState = create<CsvHeaderState>((set) => ({
  entries: {},
  register: (key, entry) =>
    set((state) => ({
      entries: { ...state.entries, [key]: entry },
    })),
  unregister: (key) =>
    set((state) => {
      if (!(key in state.entries)) {
        return state;
      }
      const entries = { ...state.entries };
      delete entries[key];
      return { entries };
    }),
}));
