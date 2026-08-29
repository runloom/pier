/**
 * Expand tab-menu placeholders for move/copy to another window:
 *   0 others → omit the item
 *   1 other  → direct "the other window" action
 *   2+       → submenu of named windows
 *
 * Concrete targets use encoded action ids (`pier.panel.moveToWindow:<id>`).
 * Dispatch of those ids lives in transfer/window-menu.ts so this module
 * does not import relocate (which would cycle back through use-menu).
 */

import {
  MENU_LIMITS,
  type MenuItem,
  type MenuItemAction,
  type MenuTemplate,
} from "@shared/contracts/menu.ts";
import i18next from "i18next";
import {
  listOtherWindows,
  type OtherWindowOption,
} from "@/components/workspace/transfer/pick-window.ts";

export const MOVE_TO_WINDOW_ACTION_ID = "pier.panel.moveToWindow";
export const COPY_TO_WINDOW_ACTION_ID = "pier.panel.copyToWindow";

const MOVE_PREFIX = `${MOVE_TO_WINDOW_ACTION_ID}:`;
const COPY_PREFIX = `${COPY_TO_WINDOW_ACTION_ID}:`;

export type WindowRelocateKind = "copy" | "move";

export function parseWindowRelocateMenuAction(actionId: string): {
  kind: WindowRelocateKind;
  windowId: string;
} | null {
  if (actionId.startsWith(MOVE_PREFIX)) {
    const windowId = actionId.slice(MOVE_PREFIX.length);
    return windowId.length > 0 ? { kind: "move", windowId } : null;
  }
  if (actionId.startsWith(COPY_PREFIX)) {
    const windowId = actionId.slice(COPY_PREFIX.length);
    return windowId.length > 0 ? { kind: "copy", windowId } : null;
  }
  return null;
}

export function formatWindowMenuLabel(option: {
  label: string;
  menuLabel?: string;
}): string {
  const raw = option.menuLabel ?? option.label;
  if (raw.length <= MENU_LIMITS.labelMaxLength) {
    return raw;
  }
  return raw.slice(0, MENU_LIMITS.labelMaxLength);
}

function encodeRelocateActionId(
  kind: WindowRelocateKind,
  windowId: string
): string | null {
  if (windowId.length === 0) {
    return null;
  }
  const prefix =
    kind === "move" ? MOVE_TO_WINDOW_ACTION_ID : COPY_TO_WINDOW_ACTION_ID;
  const id = `${prefix}:${windowId}`;
  if (id.length > MENU_LIMITS.idMaxLength) {
    return null;
  }
  return id;
}

function kindOfPlaceholder(actionId: string): WindowRelocateKind | null {
  if (actionId === MOVE_TO_WINDOW_ACTION_ID) {
    return "move";
  }
  if (actionId === COPY_TO_WINDOW_ACTION_ID) {
    return "copy";
  }
  return null;
}

function hasRelocatePlaceholder(items: readonly MenuItem[]): boolean {
  for (const item of items) {
    if (item.type === "action" && kindOfPlaceholder(item.id) != null) {
      return true;
    }
    if (item.type === "submenu" && hasRelocatePlaceholder(item.submenu)) {
      return true;
    }
  }
  return false;
}

function otherWindowTitleKey(kind: WindowRelocateKind): string {
  return kind === "move"
    ? "contextMenu.action.moveToTheOtherWindow"
    : "contextMenu.action.copyToTheOtherWindow";
}

function expandPlaceholder(
  item: MenuItemAction,
  kind: WindowRelocateKind,
  others: readonly OtherWindowOption[]
): MenuItem | null {
  const targets = others
    .slice(0, MENU_LIMITS.itemsPerLevelMax)
    .flatMap((option) => {
      const id = encodeRelocateActionId(kind, option.id);
      if (!id) {
        return [];
      }
      return [{ option, id }];
    });
  if (targets.length === 0) {
    return null;
  }
  if (targets.length === 1) {
    const only = targets[0];
    if (!only) {
      return null;
    }
    return {
      type: "action",
      id: only.id,
      label: i18next.t(otherWindowTitleKey(kind)),
      ...(item.enabled === undefined ? {} : { enabled: item.enabled }),
    };
  }
  return {
    type: "submenu",
    label: item.label,
    ...(item.enabled === undefined ? {} : { enabled: item.enabled }),
    submenu: targets.map((target) => ({
      enabled: true,
      id: target.id,
      label: formatWindowMenuLabel(target.option),
      type: "action" as const,
    })),
  };
}

function rewriteItems(
  items: readonly MenuItem[],
  others: readonly OtherWindowOption[]
): MenuItem[] {
  const next: MenuItem[] = [];
  for (const item of items) {
    if (item.type === "action") {
      const kind = kindOfPlaceholder(item.id);
      if (kind == null) {
        next.push(item);
        continue;
      }
      const expanded = expandPlaceholder(item, kind, others);
      if (expanded) {
        next.push(expanded);
      }
      continue;
    }
    if (item.type === "submenu") {
      next.push({
        ...item,
        submenu: rewriteItems(item.submenu, others),
      });
      continue;
    }
    next.push(item);
  }
  return next;
}

export async function expandWindowRelocateMenu(
  template: MenuTemplate
): Promise<MenuTemplate> {
  if (!hasRelocatePlaceholder(template)) {
    return template;
  }
  let others: OtherWindowOption[];
  try {
    others = await listOtherWindows();
  } catch {
    others = [];
  }
  return rewriteItems(template, others);
}
