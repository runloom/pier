import i18next from "i18next";
import type { Action } from "@/lib/actions/types.ts";
import {
  buildActionSearchDocument,
  rankActionSearchDocuments,
} from "@/lib/search/action.ts";

export function actionCategoryKey(action: Action): string {
  return action.metadata?.categoryKey ?? action.category;
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
