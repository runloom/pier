import type { KeyboardEvent as ReactKeyboardEvent } from "react";

export interface FilesTreeSearchKeyHandlers {
  closeSearch: () => void;
  focusedMatchOpenable: boolean;
  navigateSearch: (direction: "next" | "previous") => void;
  open: boolean;
  openFocusedMatch: () => void;
  searchActionsDisabled: boolean;
}

/** 树侧栏捕获搜索快捷键；搜索栏 input 自身已处理同组键时跳过。 */
export function handleFilesTreeSearchKeyDown(
  event: ReactKeyboardEvent<HTMLElement>,
  handlers: FilesTreeSearchKeyHandlers
): void {
  if (!handlers.open) {
    return;
  }
  if (
    event.target instanceof HTMLElement &&
    event.target.closest('[data-testid="files-tree-search-bar"]')
  ) {
    return;
  }
  if (event.key === "ArrowDown") {
    event.preventDefault();
    handlers.navigateSearch("next");
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    handlers.navigateSearch("previous");
    return;
  }
  if (event.key === "Enter") {
    if (handlers.searchActionsDisabled || !handlers.focusedMatchOpenable) {
      return;
    }
    event.preventDefault();
    handlers.openFocusedMatch();
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    handlers.closeSearch();
  }
}
