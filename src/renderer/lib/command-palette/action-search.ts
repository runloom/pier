import i18next from "i18next";
import type { Action } from "@/lib/actions/types.ts";
import {
  compareActions,
  compareGroups,
} from "@/lib/command-palette/frecency.ts";
import {
  buildActionSearchDocument,
  rankActionSearchDocuments,
} from "@/lib/search/action-search.ts";

export interface ActionGroup {
  actions: Action[];
  category: string;
}

export function groupActionsForPalette(
  actions: readonly Action[],
  frecencyMap: ReadonlyMap<string, number>,
  query: string
): ActionGroup[] {
  const normalizedQuery = query.trim();
  if (normalizedQuery.length > 0) {
    return [
      {
        actions: rankActionsForPalette(
          actions,
          frecencyMap,
          normalizedQuery,
          new Map()
        ),
        category: "Search",
      },
    ];
  }

  const map = new Map<string, Action[]>();
  for (const action of actions) {
    const list = map.get(action.category) ?? [];
    list.push(action);
    map.set(action.category, list);
  }
  const groups = Array.from(map.entries()).map(([category, list]) => ({
    category,
    actions: list,
  }));

  for (const g of groups) {
    g.actions.sort((a, b) => compareActions(a, b, frecencyMap));
  }
  return groups.sort((ga, gb) =>
    compareGroups(ga.actions, gb.actions, frecencyMap)
  );
}

export function rankActionsForPalette(
  actions: readonly Action[],
  frecencyMap: ReadonlyMap<string, number>,
  query: string,
  keybindingLabels: ReadonlyMap<string, string>
): Action[] {
  const documents = actions.map((action) => {
    const shortcutLabel = keybindingLabels.get(action.id);
    const categoryKey = action.metadata?.categoryKey;
    return buildActionSearchDocument(action, {
      ...(categoryKey
        ? { categoryLabel: i18next.t(`commandPalette.category.${categoryKey}`) }
        : {}),
      disabled: action.enabled?.() === false,
      ...(shortcutLabel ? { shortcutLabel } : {}),
    });
  });
  return rankActionSearchDocuments(documents, query, { frecencyMap }).map(
    (result) => result.document.payload
  );
}
