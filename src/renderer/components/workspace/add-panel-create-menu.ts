/**
 * 创建菜单列表排序：与命令面板 create-menu 同源 frecency，分组展示用。
 */

import type { Action } from "@/lib/actions/types.ts";
import { actionCategoryKey } from "@/lib/command-palette/action-search.ts";
import { CATEGORY_META } from "@/lib/command-palette/frecency.ts";

export interface CreateActionGroup {
  actions: Action[];
  category: string;
}

const CREATE_MENU_CATEGORY_ORDER: Readonly<Record<string, number>> = {
  run: 0,
  panel: 1,
  file: 2,
  worktree: 3,
};

function createMenuFallbackPriority(action: Action): number {
  if (action.id === "pier.panel.newTerminal") {
    return 0;
  }
  if (action.id === "pier.agent.new") {
    return 1;
  }
  if (action.id.startsWith("pier.agent.start.")) {
    return action.metadata?.sortOrder ?? 10;
  }
  if (action.id === "pier.run.task") {
    return 100;
  }
  return 200 + (action.metadata?.sortOrder ?? 0);
}

function compareCreateActions(
  a: Action,
  b: Action,
  frecencyMap: ReadonlyMap<string, number>
): number {
  const aScore = frecencyMap.get(a.id);
  const bScore = frecencyMap.get(b.id);
  if (aScore != null && bScore != null) {
    if (bScore !== aScore) {
      return bScore - aScore;
    }
    return createMenuFallbackPriority(a) - createMenuFallbackPriority(b);
  }
  if (aScore != null) {
    return -1;
  }
  if (bScore != null) {
    return 1;
  }
  return createMenuFallbackPriority(a) - createMenuFallbackPriority(b);
}

function maxGroupFrecency(
  actions: readonly Action[],
  frecencyMap: ReadonlyMap<string, number>
): number | undefined {
  let max: number | undefined;
  for (const action of actions) {
    const score = frecencyMap.get(action.id);
    if (score != null && (max == null || score > max)) {
      max = score;
    }
  }
  return max;
}

function compareCreateGroups(
  a: CreateActionGroup,
  b: CreateActionGroup,
  frecencyMap: ReadonlyMap<string, number>
): number {
  const aScore = maxGroupFrecency(a.actions, frecencyMap);
  const bScore = maxGroupFrecency(b.actions, frecencyMap);
  if (aScore != null && bScore != null) {
    return bScore - aScore;
  }
  if (aScore != null) {
    return -1;
  }
  if (bScore != null) {
    return 1;
  }
  const aOrder =
    CREATE_MENU_CATEGORY_ORDER[a.category] ??
    100 + (CATEGORY_META[a.category]?.order ?? 100);
  const bOrder =
    CREATE_MENU_CATEGORY_ORDER[b.category] ??
    100 + (CATEGORY_META[b.category]?.order ?? 100);
  return aOrder - bOrder;
}

export function groupCreateActions(
  actions: readonly Action[],
  frecencyMap: ReadonlyMap<string, number>
): CreateActionGroup[] {
  const byCategory = new Map<string, Action[]>();
  for (const action of actions) {
    const category = actionCategoryKey(action);
    const categoryActions = byCategory.get(category) ?? [];
    categoryActions.push(action);
    byCategory.set(category, categoryActions);
  }
  const groups = Array.from(byCategory.entries()).map(
    ([category, categoryActions]) => ({
      actions: categoryActions.sort((a, b) =>
        compareCreateActions(a, b, frecencyMap)
      ),
      category,
    })
  );
  return groups.sort((a, b) => compareCreateGroups(a, b, frecencyMap));
}
