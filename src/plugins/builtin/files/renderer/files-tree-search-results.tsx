import type { FilePathQueryItem } from "@shared/contracts/file-query.ts";
import { useEffect, useRef } from "react";
import { basename } from "./file-tree-action-utils.ts";

export interface FilesTreeSearchResultsProps {
  emptyDescription: string;
  emptyTitle: string;
  focusedIndex: number;
  hasNoResults: boolean;
  items: readonly FilePathQueryItem[];
  loading: boolean;
  onOpenPath: (path: string) => void;
  onSelectIndex: (index: number) => void;
  truncated: boolean;
  truncatedHint: string;
}

export function FilesTreeSearchResults({
  emptyDescription,
  emptyTitle,
  focusedIndex,
  hasNoResults,
  items,
  loading,
  onOpenPath,
  onSelectIndex,
  truncated,
  truncatedHint,
}: FilesTreeSearchResultsProps) {
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const list = listRef.current;
    if (!list) {
      return;
    }
    const focused = list.querySelector<HTMLElement>(
      `[data-search-result-index="${focusedIndex}"]`
    );
    if (focused && typeof focused.scrollIntoView === "function") {
      focused.scrollIntoView({ block: "nearest" });
    }
  }, [focusedIndex]);

  if (hasNoResults) {
    return (
      <div
        aria-live="polite"
        className="flex h-full min-h-0 flex-col items-center justify-center gap-1.5 p-4 text-center"
        data-testid="files-tree-search-empty"
        role="status"
      >
        <p className="text-sidebar-foreground text-sm">{emptyTitle}</p>
        <p className="text-muted-foreground text-xs">{emptyDescription}</p>
      </div>
    );
  }

  if (items.length === 0 && loading) {
    return (
      <div
        className="flex h-full min-h-0 items-center justify-center p-4 text-muted-foreground text-xs"
        data-testid="files-tree-search-results"
        role="status"
      >
        …
      </div>
    );
  }

  if (items.length === 0) {
    return null;
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-testid="files-tree-search-results"
    >
      {truncated ? (
        <p
          className="shrink-0 border-sidebar-border border-b px-2 py-1 text-[11px] text-muted-foreground"
          data-testid="files-tree-search-truncated"
        >
          {truncatedHint}
        </p>
      ) : null}
      <div
        aria-label="Search results"
        className="min-h-0 flex-1 overflow-y-auto py-1"
        ref={listRef}
        role="listbox"
      >
        {items.map((item, index) => {
          const selected = index === focusedIndex;
          return (
            <button
              aria-selected={selected}
              className={
                selected
                  ? "flex w-full min-w-0 flex-col gap-0.5 bg-sidebar-accent px-2 py-1 text-left text-sidebar-accent-foreground"
                  : "flex w-full min-w-0 flex-col gap-0.5 px-2 py-1 text-left text-sidebar-foreground hover:bg-sidebar-accent/60"
              }
              data-search-result-index={index}
              data-testid="files-tree-search-result"
              key={item.path}
              onClick={() => {
                onSelectIndex(index);
                onOpenPath(item.path);
              }}
              onMouseEnter={() => {
                onSelectIndex(index);
              }}
              role="option"
              type="button"
            >
              <span className="truncate font-medium text-xs">
                {basename(item.path)}
              </span>
              <span className="truncate text-[11px] text-muted-foreground">
                {item.path}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
