import type { MenuTemplate } from "@shared/contracts/menu.ts";
import i18next from "i18next";
import type { MouseEvent } from "react";
import { popupMenuTemplateAt } from "@/lib/context-menu/use-menu.ts";
import { cssPointToContentViewPoint } from "@/lib/window-zoom/coordinates.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import { useZoomStore } from "@/stores/zoom.store.ts";
import type { WidgetHeaderAction } from "./widget-actions.tsx";

/**
 * 卡片右键：与卡头 ⋯ 同一 action 列表（原生菜单，避免与 RGL 拖拽冲突用 stopPropagation）。
 */
export function openWorkbenchWidgetContextMenu(
  event: MouseEvent,
  actions: readonly WidgetHeaderAction[]
): void {
  if (event.defaultPrevented) {
    return;
  }
  const target = event.target;
  if (
    target instanceof Element &&
    (target.closest('[data-slot="dropdown-menu-trigger"]') ||
      target.closest("button, a, input, textarea, select, [data-no-drag]"))
  ) {
    // 卡头控件 / 交互元素自管；不抢右键。
    return;
  }
  const enabled = actions.filter((action) => !action.disabled);
  if (enabled.length === 0) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  const template: MenuTemplate = enabled.map((action) => ({
    enabled: true,
    id: action.id,
    label: action.label,
    type: "action" as const,
  }));
  const coords = cssPointToContentViewPoint(
    { x: event.clientX, y: event.clientY },
    useZoomStore.getState().windowZoomLevel
  );
  const byId = new Map(enabled.map((action) => [action.id, action]));
  popupMenuTemplateAt(template, coords, async (actionId) => {
    const action = byId.get(actionId);
    if (!action) {
      return;
    }
    try {
      await action.invoke();
    } catch (error) {
      await showAppAlert({
        body: error instanceof Error ? error.message : String(error),
        title: i18next.t("workbench.widget.actionFailed"),
      });
    }
  }).catch((error: unknown) => {
    showAppAlert({
      body: error instanceof Error ? error.message : String(error),
      title: i18next.t("workbench.context.menuFailed"),
    });
  });
}
