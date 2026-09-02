import { useEffect, useRef } from "react";
import type { Action } from "@/lib/actions/types.ts";
import {
  commandListHasItemValue,
  firstCommandListItemValue,
  type PresentedCommandGroup,
} from "@/lib/command-palette/present-groups.ts";

interface UseCommandPaletteCommandsSelectionOptions {
  groups: readonly PresentedCommandGroup[];
  mode: "commands" | "quick-pick";
  normalizedQuery: string;
  rankedActions: readonly Action[];
  selectedValue: string;
  setSelectedValue: (value: string) => void;
}

/**
 * commands 模式选中策略：
 * - 搜索词变化 → 回到当前结果第一项
 * - 清空搜索 / 打开 → 回到分组列表第一项
 * - 列表重排后当前项消失 → 回顶
 */
export function useCommandPaletteCommandsSelection({
  groups,
  mode,
  normalizedQuery,
  rankedActions,
  selectedValue,
  setSelectedValue,
}: UseCommandPaletteCommandsSelectionOptions): void {
  const lastQueryRef = useRef(normalizedQuery);

  useEffect(() => {
    if (mode !== "commands") {
      return;
    }
    const queryChanged = lastQueryRef.current !== normalizedQuery;
    lastQueryRef.current = normalizedQuery;
    if (normalizedQuery.length > 0) {
      if (
        !queryChanged &&
        rankedActions.some((action) => action.id === selectedValue)
      ) {
        return;
      }
      setSelectedValue(rankedActions[0]?.id ?? "");
      return;
    }
    const firstId = firstCommandListItemValue(groups);
    if (!firstId) {
      setSelectedValue("");
      return;
    }
    const stillVisible = commandListHasItemValue(groups, selectedValue);
    if (queryChanged || !stillVisible || selectedValue === "") {
      setSelectedValue(firstId);
    }
  }, [
    groups,
    mode,
    normalizedQuery,
    rankedActions,
    selectedValue,
    setSelectedValue,
  ]);
}
