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
import {
  type MouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { useContextMenu } from "@/lib/context-menu/use-context-menu.ts";
import { panelIconOf } from "./panel-registry.ts";
import { revealDockviewTabElement } from "./tab-visibility.ts";

export function PanelTabHeader(props: IDockviewPanelHeaderProps) {
  const [title, setTitle] = useState<string>(props.api.title ?? "");
  const tabRef = useRef<HTMLDivElement>(null);
  const Icon = panelIconOf(props.api.component);
  useEffect(() => {
    // dockview onDidTitleChange fire 时把新 title 写入 state, 触发 tab 重渲.
    const disposable = props.api.onDidTitleChange((e) => {
      setTitle(e.title);
    });
    // mount 时 sync 一次防 onDidTitleChange 未 fire 但 props.api.title 已变.
    setTitle(props.api.title ?? "");
    return () => {
      disposable.dispose();
    };
  }, [props.api]);

  useEffect(() => {
    let revealFrame: number | null = null;
    const cancelReveal = () => {
      if (revealFrame !== null) {
        cancelAnimationFrame(revealFrame);
        revealFrame = null;
      }
    };
    const reveal = () => {
      cancelReveal();
      revealFrame = requestAnimationFrame(() => {
        revealFrame = null;
        if (tabRef.current) {
          revealDockviewTabElement(tabRef.current);
        }
      });
    };

    if (props.api.isActive) {
      reveal();
    }
    const disposable = props.api.onDidActiveChange((event) => {
      if (event.isActive) {
        reveal();
      } else {
        cancelReveal();
      }
    });
    return () => {
      cancelReveal();
      disposable.dispose();
    };
  }, [props.api]);

  const baseOnContextMenu = useContextMenu("dockview-tab");
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
      data-panel-tab-id={props.api.id}
      onContextMenu={onContextMenu}
      ref={tabRef}
      role="tab"
      tabIndex={0}
    >
      {Icon ? (
        <Icon
          aria-hidden="true"
          className="pier-panel-tab-icon shrink-0"
          data-panel-tab-icon={props.api.component}
          strokeWidth={2.35}
        />
      ) : null}
      <span className="dv-default-tab-content">{title}</span>
      <button
        aria-label="Close tab"
        className="dv-default-tab-action"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          props.api.setActive();
          actionRegistry.get("pier.panel.close")?.handler();
        }}
        onPointerDown={(e) => e.preventDefault()}
        type="button"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}
