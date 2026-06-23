/**
 * 给 React 组件提供 onContextMenu handler — 阻止浏览器默认菜单, 调 main popup,
 * dispatch 选中的 action.
 *
 * usage:
 *   const onContextMenu = useContextMenu("dockview-tab", { panelId });
 *   <div onContextMenu={onContextMenu}>...</div>
 *
 * args 透传给 action.handler 暂未启用 (Action.handler 当前签名是 () => void).
 * 后续要让 action 知道 target panelId 时, 把 args 通过 closure 或 context 传给 handler.
 * Phase 1 的 actions 都用 store.getState() 读 active panel 决策, 不需 args.
 */
import { type MouseEvent, useCallback } from "react";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { buildMenuEntries } from "./build-entries.ts";

/**
 * useContextMenu options. IMPORTANT: 调用方若传入 options 对象, 必须用 useMemo
 * 包裹保证稳定引用 — 否则每次 render 都产生新 onContextMenu 引用, 触发挂载的
 * panel/tab 组件 re-render. Phase 1 暂无 caller 传 options, 留作未来 contract.
 */
export interface UseContextMenuOptions {
  /**
   * 自定义触发坐标 — 默认用 React event.clientX / clientY (BrowserWindow 内坐标).
   * 来自 swift 转发的右键事件需要由调用方提前转好坐标传入.
   */
  getCoords?: (event: MouseEvent) => { x: number; y: number };
}

export function useContextMenu(
  surface: string,
  _args?: Record<string, unknown>,
  options?: UseContextMenuOptions
): (event: MouseEvent) => void {
  return useCallback(
    (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const coords = options?.getCoords?.(event) ?? {
        x: event.clientX,
        y: event.clientY,
      };
      popupAndDispatch(surface, coords).catch((err: unknown) => {
        console.error(`[menu] unhandled popup ${surface}:`, err);
      });
    },
    [surface, options]
  );
}

/**
 * 不在 React tree 内时 (例 swift 转发的右键) 直接调用: 不需要 hook 上下文,
 * 同样的逻辑给坐标 + surface 即可弹菜单.
 */
export async function popupContextMenuAt(
  surface: string,
  coords: { x: number; y: number }
): Promise<void> {
  await popupAndDispatch(surface, coords);
}

async function popupAndDispatch(
  surface: string,
  coords: { x: number; y: number }
): Promise<void> {
  const template = buildMenuEntries(surface);
  if (template.length === 0) {
    return;
  }

  const result = await window.pier.menu
    .popup(template, coords)
    .catch((err: unknown) => {
      console.error(`[menu] popup ${surface} failed:`, err);
      return null;
    });
  if (!result?.actionId) {
    return;
  }

  const action = actionRegistry.get(result.actionId);
  if (!action) {
    console.warn(
      `[menu] action ${result.actionId} not found (registered after menu open?)`
    );
    return;
  }
  if (action.enabled?.() === false) {
    return;
  }

  await Promise.resolve(action.handler()).catch((err: unknown) => {
    console.error(`[menu] action ${result.actionId} threw:`, err);
  });
}
