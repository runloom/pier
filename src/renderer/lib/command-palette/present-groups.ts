/**
 * 命令面板 / 新建菜单空态分组：标题门槛、合并单项、智能体子组、最近块。
 * 权威：docs/superpowers/specs/2026-09-02-command-list-heading-gold-standard.md
 */

import { AGENT_START_COMMAND_PREFIX } from "@shared/commands.ts";
import type { Action } from "@/lib/actions/types.ts";
import { actionCategoryKey } from "@/lib/command-palette/action-search.ts";
import {
  CATEGORY_META,
  UNKNOWN_ORDER,
} from "@/lib/command-palette/frecency.ts";

export const COMMAND_PALETTE_RECENTS_LIMIT = 8;

export const RECENT_PRESENTATION_ID = "recent";
export const AGENT_PRESENTATION_ID = "agent";

export const CREATE_MENU_CATEGORY_ORDER: Readonly<Record<string, number>> = {
  run: 0,
  panel: 1,
  file: 2,
  worktree: 3,
  window: 4,
};

export const PALETTE_CATEGORY_ORDER: Readonly<Record<string, number>> =
  Object.fromEntries(
    Object.entries(CATEGORY_META).map(([key, meta]) => [key, meta.order])
  );

export interface PresentedCommandGroup {
  actions: Action[];
  heading: string | null;
  id: string;
  separatorAfter?: boolean;
}

/** cmdk 选中身份。最近块与分类块会各渲染同一条命令，禁止都用 action.id。 */
export function commandListItemValue(
  groupId: string,
  actionId: string
): string {
  return `${groupId}:${actionId}`;
}

export function firstCommandListItemValue(
  groups: readonly PresentedCommandGroup[]
): string {
  const group = groups[0];
  const action = group?.actions[0];
  if (!(group && action)) {
    return "";
  }
  return commandListItemValue(group.id, action.id);
}

export function commandListHasItemValue(
  groups: readonly PresentedCommandGroup[],
  value: string
): boolean {
  return groups.some((group) =>
    group.actions.some(
      (action) => commandListItemValue(group.id, action.id) === value
    )
  );
}

export interface PresentCommandListGroupsOptions {
  categoryLabel: (category: string) => string;
  categoryOrder: Readonly<Record<string, number>>;
  frecencyMap?: ReadonlyMap<string, number>;
  itemCompare: (a: Action, b: Action) => number;
  recentLabel: string;
  recentsLimit: number;
}

export function commandListCategoryLabel(
  category: string,
  translate: (key: string) => string
): string {
  if (category === AGENT_PRESENTATION_ID) {
    return translate("commandPalette.category.agent");
  }
  const meta = CATEGORY_META[category];
  if (!meta) {
    return category;
  }
  return translate(`commandPalette.category.${meta.labelKey}`);
}

function createMenuFallbackPriority(action: Action): number {
  if (action.id === "pier.panel.newTerminal") {
    return 0;
  }
  if (action.id === "pier.agent.new") {
    return 1;
  }
  if (action.id.startsWith(AGENT_START_COMMAND_PREFIX)) {
    return action.metadata?.sortOrder ?? 10;
  }
  if (action.id === "pier.run.task") {
    return 100;
  }
  return 200 + (action.metadata?.sortOrder ?? 0);
}

export function compareCreateMenuItems(a: Action, b: Action): number {
  const byPriority =
    createMenuFallbackPriority(a) - createMenuFallbackPriority(b);
  if (byPriority !== 0) {
    return byPriority;
  }
  const bySortOrder =
    (a.metadata?.sortOrder ?? 0) - (b.metadata?.sortOrder ?? 0);
  if (bySortOrder !== 0) {
    return bySortOrder;
  }
  return a.id.localeCompare(b.id);
}

export function comparePaletteItems(a: Action, b: Action): number {
  const bySortOrder =
    (a.metadata?.sortOrder ?? 0) - (b.metadata?.sortOrder ?? 0);
  if (bySortOrder !== 0) {
    return bySortOrder;
  }
  return a.id.localeCompare(b.id);
}

function isAgentStartAction(action: Action): boolean {
  return action.id.startsWith(AGENT_START_COMMAND_PREFIX);
}

function categoryOrderValue(
  category: string,
  categoryOrder: Readonly<Record<string, number>>
): number {
  if (category === AGENT_PRESENTATION_ID) {
    return (categoryOrder.run ?? CATEGORY_META.run?.order ?? 0) + 0.5;
  }
  const explicit = categoryOrder[category];
  if (explicit != null) {
    return explicit;
  }
  return 100 + (CATEGORY_META[category]?.order ?? UNKNOWN_ORDER);
}

function recentActions(
  actions: readonly Action[],
  frecencyMap: ReadonlyMap<string, number>,
  recentsLimit: number
): Action[] {
  return actions
    .filter((action) => action.metadata?.excludeFromMru !== true)
    .flatMap((action) => {
      const score = frecencyMap.get(action.id);
      return score == null ? [] : [{ action, score }];
    })
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.action.id.localeCompare(b.action.id);
    })
    .slice(0, recentsLimit)
    .map((entry) => entry.action);
}

function mergeAdjacentUnheaded(
  groups: readonly PresentedCommandGroup[]
): PresentedCommandGroup[] {
  const merged: PresentedCommandGroup[] = [];
  let unheadedIndex = 0;
  for (const group of groups) {
    const last = merged.at(-1);
    if (group.heading == null && last != null && last.heading == null) {
      last.actions.push(...group.actions);
      continue;
    }
    if (group.heading == null) {
      merged.push({
        actions: [...group.actions],
        heading: null,
        id: `unheaded:${unheadedIndex}`,
      });
      unheadedIndex += 1;
      continue;
    }
    merged.push(group);
  }
  return merged;
}

export function presentCommandListGroups(
  actions: readonly Action[],
  options: PresentCommandListGroupsOptions
): PresentedCommandGroup[] {
  const frecencyMap = options.frecencyMap ?? new Map<string, number>();
  const presented: PresentedCommandGroup[] = [];

  if (options.recentsLimit > 0) {
    const recents = recentActions(actions, frecencyMap, options.recentsLimit);
    if (recents.length > 0) {
      presented.push({
        actions: recents,
        heading: recents.length >= 2 ? options.recentLabel : null,
        id: RECENT_PRESENTATION_ID,
      });
    }
  }

  const buckets = new Map<string, Action[]>();
  for (const action of actions) {
    const category = actionCategoryKey(action);
    const list = buckets.get(category) ?? [];
    list.push(action);
    buckets.set(category, list);
  }

  const runBucket = buckets.get("run") ?? [];
  const agentStarts = runBucket.filter(isAgentStartAction);
  if (agentStarts.length >= 2) {
    const remainingRun = runBucket.filter(
      (action) => !isAgentStartAction(action)
    );
    if (remainingRun.length > 0) {
      buckets.set("run", remainingRun);
    } else {
      buckets.delete("run");
    }
    buckets.set(AGENT_PRESENTATION_ID, agentStarts);
  }

  const categoryGroups: PresentedCommandGroup[] = Array.from(buckets.keys())
    .sort((a, b) => {
      const byOrder =
        categoryOrderValue(a, options.categoryOrder) -
        categoryOrderValue(b, options.categoryOrder);
      if (byOrder !== 0) {
        return byOrder;
      }
      return a.localeCompare(b);
    })
    .flatMap((category) => {
      const categoryActions = [...(buckets.get(category) ?? [])].sort(
        options.itemCompare
      );
      if (categoryActions.length === 0) {
        return [];
      }
      return [
        {
          actions: categoryActions,
          heading:
            categoryActions.length >= 2
              ? options.categoryLabel(category)
              : null,
          id: category,
        },
      ];
    });

  const merged = mergeAdjacentUnheaded(categoryGroups);
  if (presented[0]?.id === RECENT_PRESENTATION_ID && merged.length > 0) {
    presented[0] = { ...presented[0], separatorAfter: true };
  }
  return [...presented, ...merged];
}
