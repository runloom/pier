/**
 * Dockview 自定义 tab 组件 — 接管 onContextMenu, 弹 surface="dockview-tab" 菜单.
 *
 * 不传 getTabContextMenuItems 给 DockviewReact: dockview 内置 contextmenu listener
 * 在没传该 prop 时 early-return 不 preventDefault, 事件冒泡到这里的 onContextMenu
 * (dockview-react@6.6.1, components/tab/tab.js:116 + contextMenu.js:118-132).
 *
 * 右键 → 显式 setActive 确保 actions 拿到的 activePanel 就是被右键的 tab. dockview
 * onPointerDown 在 contextmenu 之前 fire 时本会顺带激活, 但 macOS 上鼠标右键的
 * pointerdown→contextmenu 顺序与 dockview tab 内部 setActive 触发条件未必每次都满
 * (单 group 内已 active 的 tab 上再右键不会重新 setActive, 但行为也无需变更, 安全).
 *
 * 样式: 用 dockview 默认 `.dv-default-tab` class 维持 hover/active 状态. 若样式与
 * 改前不一致, inspect DOM 取 dockview 实际默认 tab 的 class 对齐.
 */
import type { IDockviewPanelHeaderProps } from "dockview-react";
import { X } from "lucide-react";
import { type MouseEvent, useCallback } from "react";
import { useContextMenu } from "@/lib/context-menu/use-context-menu.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

export function PanelTabHeader(props: IDockviewPanelHeaderProps) {
  // 第二参 _args 在 hook 内未被 useCallback deps 引用 (use-context-menu.ts:_args 标记
  // unused), 内联对象每次 render 新引用不会导致 baseOnContextMenu 重建. 第三参
  // options 才需要 useMemo 稳定引用 (Phase 1 不传).
  const baseOnContextMenu = useContextMenu("dockview-tab", {
    panelId: props.api.id,
  });
  const onContextMenu = useCallback(
    (event: MouseEvent) => {
      props.api.setActive();
      baseOnContextMenu(event);
    },
    [baseOnContextMenu, props.api]
  );
  // biome a11y noStaticElementInteractions / noNoninteractiveElementInteractions 要求
  // onContextMenu div 有 role. dockview 外层 .dv-tab 已有 tabIndex=0, 两层重叠影响有限:
  // 外层是 dockview 自己渲染的 DOM, 不受此 React 树控制.
  return (
    <div
      className="dv-default-tab"
      onContextMenu={onContextMenu}
      role="tab"
      tabIndex={0}
    >
      <span className="dv-default-tab-content">{props.api.title ?? ""}</span>
      <button
        aria-label="Close tab"
        className="dv-default-tab-action"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          useWorkspaceStore.getState().closePanel(props.api.id);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        type="button"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}
