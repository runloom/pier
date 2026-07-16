import {
  FileSearchBar,
  type FileSearchBarLabels,
  type FileSearchOptionKey,
  type FileSearchOptions,
} from "@pier/ui/file-search-bar.tsx";
import type { ComponentProps } from "react";

export type FilesSearchBarLabels = FileSearchBarLabels;
export type FilesSearchOptionKey = FileSearchOptionKey;
export type FilesSearchOptions = FileSearchOptions;

export function FilesSearchBar(props: ComponentProps<typeof FileSearchBar>) {
  return <FileSearchBar {...props} controlsSlot="files-search-controls" />;
}
