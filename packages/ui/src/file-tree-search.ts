import * as React from "react";
import { stripTrailingSlash } from "./file-tree-model.ts";

interface SearchMatchModel {
  getFocusedPath: () => string | null;
  getItem: (path: string) => SearchMatchHandle | null;
  getSearchMatchingPaths: () => readonly string[];
  getSelectedPaths: () => readonly string[];
  selectOnlyPath: (path: string) => void;
  subscribe: (listener: () => void) => () => void;
}

interface SearchMatchHandle {
  isSelected: () => boolean;
}

interface SearchMatchItem {
  kind: "directory" | "file";
  path: string;
}

interface SearchMatchRefs {
  itemsByPath: ReadonlyMap<string, SearchMatchItem>;
  onOpenPath: ((path: string) => void) | undefined;
}

interface SearchMatchState {
  focusedMatchOpenable: boolean;
  matchCount: number;
}

function getSearchMatchState(
  model: SearchMatchModel,
  refs: SearchMatchRefs
): SearchMatchState {
  const matchingPaths = model.getSearchMatchingPaths();
  const focusedPath = model.getFocusedPath();
  const focusedItem =
    focusedPath == null || !matchingPaths.includes(focusedPath)
      ? undefined
      : refs.itemsByPath.get(stripTrailingSlash(focusedPath));
  return {
    focusedMatchOpenable: focusedItem?.kind === "file",
    matchCount: matchingPaths.length,
  };
}

export function activateFocusedMatch(
  model: SearchMatchModel,
  refs: SearchMatchRefs
): boolean {
  const focusedPath = model.getFocusedPath();
  if (
    focusedPath == null ||
    !model.getSearchMatchingPaths().includes(focusedPath)
  ) {
    return false;
  }
  const item = refs.itemsByPath.get(stripTrailingSlash(focusedPath));
  if (item?.kind !== "file") {
    return false;
  }
  const handle = model.getItem(focusedPath);
  if (!handle) {
    return false;
  }
  const alreadyOnlySelected =
    handle.isSelected() && model.getSelectedPaths().length === 1;
  model.selectOnlyPath(focusedPath);
  if (alreadyOnlySelected) {
    refs.onOpenPath?.(item.path);
  }
  return true;
}

/** 把第三方树模型的匹配数和聚焦项能力转成受控的 React 回调。 */
export function useSearchMatchState(
  model: SearchMatchModel,
  refs: SearchMatchRefs,
  onChange: ((state: SearchMatchState) => void) | undefined
): void {
  const onChangeRef = React.useRef(onChange);
  React.useLayoutEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  React.useEffect(() => {
    const notify = () => {
      onChangeRef.current?.(getSearchMatchState(model, refs));
    };
    notify();
    return model.subscribe(notify);
  }, [model, refs]);
}
