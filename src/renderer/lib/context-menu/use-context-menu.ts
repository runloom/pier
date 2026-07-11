/**
 * 给 React 组件提供 onContextMenu handler — 阻止浏览器默认菜单, 调 main popup,
 * dispatch 选中的 action.
 *
 * usage:
 *   const onContextMenu = useContextMenu("dockview-tab");
 *   <div onContextMenu={onContextMenu}>...</div>
 *
 * Phase 1 的 actions 都用 store.getState() 读 active panel 决策, 不需传 args.
 */
import {
  releaseTooltipSuppression,
  suppressTooltips,
} from "@pier/ui/tooltip.tsx";
import type { MenuTemplate } from "@shared/contracts/menu.ts";
import { type MouseEvent, useCallback } from "react";
import { actionRegistry } from "@/lib/actions/registry.ts";
import type { ActionInvocation } from "@/lib/actions/types.ts";
import { cssPointToContentViewPoint } from "@/lib/window-zoom/coordinates.ts";
import { useZoomStore } from "@/stores/zoom.store.ts";
import { buildMenuEntries } from "./build-entries.ts";

/**
 * useContextMenu options. IMPORTANT: 调用方若传入 options 对象, 必须用 useMemo
 * 包裹保证稳定引用 — 否则每次 render 都产生新 onContextMenu 引用, 触发挂载的
 * panel/tab 组件 re-render. Phase 1 暂无 caller 传 options, 留作未来 contract.
 */
export interface UseContextMenuOptions {
  /**
   * 自定义触发坐标 — 返回值必须是 BrowserWindow contentView 坐标.
   * 默认路径会把 React event.clientX / clientY 从 CSS px 转成 contentView 坐标.
   */
  getCoords?: (event: MouseEvent) => { x: number; y: number };
  invocation?: Omit<ActionInvocation, "surface">;
}

export function useContextMenu(
  surface: string,
  options?: UseContextMenuOptions
): (event: MouseEvent) => void {
  return useCallback(
    (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const coords =
        options?.getCoords?.(event) ??
        cssPointToContentViewPoint(
          {
            x: event.clientX,
            y: event.clientY,
          },
          useZoomStore.getState().windowZoomLevel
        );
      popupAndDispatch(surface, coords, options?.invocation).catch(
        (err: unknown) => {
          console.error(`[menu] unhandled popup ${surface}:`, err);
        }
      );
    },
    [surface, options]
  );
}

export async function popupMenuTemplateAt(
  template: MenuTemplate,
  coords: { x: number; y: number },
  onPicked: (actionId: string) => Promise<void> | void
): Promise<void> {
  if (template.length === 0) {
    return;
  }
  suppressTooltips();
  try {
    const result = await window.pier.menu.popup(template, coords);
    if (result.actionId) {
      await onPicked(result.actionId);
    }
  } finally {
    releaseTooltipSuppression();
  }
}

/**
 * 不在 React tree 内时 (例 swift 转发的右键) 直接调用: 不需要 hook 上下文.
 * coords 必须已经是 BrowserWindow contentView 坐标.
 */
export async function popupContextMenuAt(
  surface: string,
  coords: { x: number; y: number },
  invocation?: Omit<ActionInvocation, "surface">
): Promise<void> {
  await popupAndDispatch(surface, coords, invocation);
}

async function popupAndDispatch(
  surface: string,
  coords: { x: number; y: number },
  invocation?: Omit<ActionInvocation, "surface">
): Promise<void> {
  const actionInvocation = { ...invocation, surface };
  const template = buildMenuEntries(surface, actionInvocation);
  await popupMenuTemplateAt(template, coords, async (actionId) => {
    const action = actionRegistry.get(actionId);
    if (!action) {
      console.warn(
        `[menu] action ${actionId} not found (registered after menu open?)`
      );
      return;
    }
    try {
      if (action.enabled?.(actionInvocation) === false) {
        return;
      }
    } catch (err) {
      console.error(`[menu] action ${actionId} enabled() threw:`, err);
      return;
    }
    await Promise.resolve(action.handler(actionInvocation)).catch(
      (err: unknown) => {
        console.error(`[menu] action ${actionId} threw:`, err);
      }
    );
  }).catch((err: unknown) => {
    console.error(`[menu] popup ${surface} failed:`, err);
  });
}
