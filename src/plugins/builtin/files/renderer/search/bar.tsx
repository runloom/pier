import {
  FileSearchBar,
  type FileSearchBarLabels,
  type FileSearchOptionKey,
  type FileSearchOptions,
} from "@pier/ui/file/search-bar.tsx";
import type { ComponentProps } from "react";

export type FilesSearchBarLabels = FileSearchBarLabels;
export type FilesSearchOptionKey = FileSearchOptionKey;
export type FilesSearchOptions = FileSearchOptions;

/**
 * Shared overlay placement for in-file find (source editor + markdown preview).
 * Keep both modes on the same corner so the chrome feels like one surface.
 * z-40 sits above markdown outline ticks/hover (`z-20`/`z-30`) so find stays
 * usable when both occupy the top-right on short frames.
 * Tree search is layout-owned by the sidebar and does not use this class.
 */
export const FILES_IN_FILE_SEARCH_BAR_CLASSNAME =
  "absolute top-2 right-3 z-40 max-w-[calc(100%-1.5rem)]";

export function FilesSearchBar(props: ComponentProps<typeof FileSearchBar>) {
  return <FileSearchBar {...props} controlsSlot="files-search-controls" />;
}
