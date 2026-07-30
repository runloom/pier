/**
 * Dockview 自定义 tab 组件 — 接管 onContextMenu, 弹 surface="dockview-tab" 菜单.
 *
 * 不传 getTabContextMenuItems 给 DockviewReact: dockview 内置 contextmenu listener
 * 在没传该 prop 时 early-return 不 preventDefault, 事件冒泡到这里的 onContextMenu
 * (dockview-react@6.6.1, components/tab/tab.js:116 + contextMenu.js:118-132).
 *
 * 右键菜单经 invocation.sourcePanelId 锚定目标 tab，**不**在打开菜单时 setActive：
 * 关 inactive tab 须保持当前 active（与 × 路径、panelCloseFocusPolicy=adjacent 一致）。
 *
 * 样式: 用 dockview 默认 `.dv-default-tab` class 维持 hover/active 状态. 若样式与
 * 改前不一致, inspect DOM 取 dockview 实际默认 tab 的 class 对齐.
 */

import { Tooltip, TooltipContent, TooltipTrigger } from "@pier/ui/tooltip.tsx";
import type { IDockviewPanelHeaderProps } from "dockview-react";
import { X } from "lucide-react";
import {
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useT } from "@/i18n/use-t.ts";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { useContextMenu } from "@/lib/context-menu/use-context-menu.ts";
import { ensureTuiInputFocus } from "@/panel-kits/terminal/tui-input-focus.ts";
import { usePanelDescriptorStore } from "@/stores/panel-descriptor.store.ts";
import {
  panelHasActiveTaskRun,
  useTaskRunsStore,
} from "@/stores/task-runs.store.ts";
import { terminalComposerTakeoverFocus } from "@/stores/terminal-composer-takeover.ts";
import { requestTerminalFocusIntent } from "@/stores/terminal-input-routing-slice.ts";
import { PanelTabLeadingIcon } from "./panel-tab-leading-icon.tsx";
import {
  PANEL_TAB_TOOLTIP_DELAY_MS,
  tabAriaLabel,
  tabStatusIndicator,
  tabTooltipText,
} from "./panel-tab-tooltip.tsx";

export { PANEL_TAB_TOOLTIP_DELAY_MS } from "./panel-tab-tooltip.tsx";

const FILE_PANEL_COMPONENT_ID = "pier.files.filePanel";

// dockview panel params 里可选 `pinned: boolean`。只有文件面板显式
// pinned:false 才是 preview tab(Cursor / VS Code 语义:斜体 + 半透明);
// 其他 panel 不设置 pinned 时必须按正常 tab 处理。
interface PanelPreviewParams {
  dirty?: unknown;
  pinned?: unknown;
}

function paramsIsPreview(
  component: string | undefined,
  params: PanelPreviewParams | undefined
): boolean {
  return component === FILE_PANEL_COMPONENT_ID && params?.pinned === false;
}

// 文件面板未保存标记(VS Code 语义:tab 上的实心圆点)。dirty 由 files 插件
// 经 updateParameters 写进 params,与 preview 斜体同一条数据通道。
function paramsIsDirty(
  component: string | undefined,
  params: PanelPreviewParams | undefined
): boolean {
  return component === FILE_PANEL_COMPONENT_ID && params?.dirty === true;
}

export function PanelTabHeader(props: IDockviewPanelHeaderProps) {
  const t = useT();
  const [title, setTitle] = useState<string>(props.api.title ?? "");
  const [isPreview, setIsPreview] = useState<boolean>(() =>
    paramsIsPreview(
      props.api.component,
      props.params as PanelPreviewParams | undefined
    )
  );
  const [isDirty, setIsDirty] = useState<boolean>(() =>
    paramsIsDirty(
      props.api.component,
      props.params as PanelPreviewParams | undefined
    )
  );
  const isPreviewRef = useRef(isPreview);
  const suppressNextDoubleClickRef = useRef(false);
  const wasActiveOnPointerDownRef = useRef(false);
  const descriptor = usePanelDescriptorStore(
    (state) => state.descriptors[props.api.id]
  );
  const showActiveTaskDot = useTaskRunsStore((state) =>
    panelHasActiveTaskRun(state.snapshot, props.api.id)
  );
  const tab = descriptor?.tab;
  const displayTitle = tab?.title ?? title;
  const tooltipText = tabTooltipText(
    tab?.tooltip,
    descriptor?.display.long ?? descriptor?.display.terminalTitle,
    tab?.state?.label,
    t
  );
  const status = tab?.state?.status;
  const statusIndicator = status
    ? tabStatusIndicator(status, tab?.state?.label)
    : null;
  // Chrome/VS Code model: ⌘1–9 works with no hold-to-reveal chrome.
  const leadingVisual: ReactNode = (
    <PanelTabLeadingIcon component={props.api.component} tab={tab} />
  );
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
    // params 变更时同步 preview 视觉 —— 文件面板 preview→pinned 就地 promote
    // 时通过 updateParameters 覆盖 pinned:true,tab 头收到事件后取消斜体。
    const disposable = props.api.onDidParametersChange((next) => {
      const nextIsPreview = paramsIsPreview(
        props.api.component,
        next as PanelPreviewParams | undefined
      );
      isPreviewRef.current = nextIsPreview;
      setIsPreview(nextIsPreview);
      setIsDirty(
        paramsIsDirty(
          props.api.component,
          next as PanelPreviewParams | undefined
        )
      );
    });
    const nextIsPreview = paramsIsPreview(
      props.api.component,
      props.params as PanelPreviewParams | undefined
    );
    isPreviewRef.current = nextIsPreview;
    setIsPreview(nextIsPreview);
    setIsDirty(
      paramsIsDirty(
        props.api.component,
        props.params as PanelPreviewParams | undefined
      )
    );
    return () => {
      disposable.dispose();
    };
  }, [props.api, props.params]);

  const contextMenuOptions = useMemo(
    () => ({
      invocation: {
        ...(props.api.component
          ? { sourcePanelComponent: props.api.component }
          : {}),
        ...(descriptor?.context
          ? { sourcePanelContext: descriptor.context }
          : {}),
        ...(typeof props.api.group?.id === "string"
          ? { sourcePanelGroupId: props.api.group.id }
          : {}),
        sourcePanelId: props.api.id,
      },
    }),
    [
      descriptor?.context,
      props.api.component,
      props.api.group?.id,
      props.api.id,
    ]
  );
  // 不包一层 setActive：useContextMenu(dockview-tab) 也不再预激活；关闭等动作走
  // sourcePanelId。需要聚焦的动作在 handler 内自行 setActive。
  const onContextMenu = useContextMenu("dockview-tab", contextMenuOptions);
  const publishTerminalFocusIntent = useCallback(() => {
    if (props.api.component !== "terminal") {
      return;
    }
    // Rich Input 打开时：点已激活 tab 应 refocus 输入框，不能只把键盘交回 native。
    if (terminalComposerTakeoverFocus(props.api.id, "activate")) {
      return;
    }
    requestTerminalFocusIntent(props.api.id);
    ensureTuiInputFocus(props.api.id).catch(() => undefined);
  }, [props.api.component, props.api.id]);
  const onClick = useCallback(() => {
    const shouldReplay = wasActiveOnPointerDownRef.current;
    wasActiveOnPointerDownRef.current = false;
    if (shouldReplay) {
      publishTerminalFocusIntent();
    }
  }, [publishTerminalFocusIntent]);
  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.target !== event.currentTarget) {
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        publishTerminalFocusIntent();
      }
    },
    [publishTerminalFocusIntent]
  );
  const promotePreview = useCallback(() => {
    if (!isPreviewRef.current) {
      return false;
    }
    isPreviewRef.current = false;
    props.api.updateParameters({ pinned: true });
    setIsPreview(false);
    return true;
  }, [props.api]);
  const onDoubleClick = useCallback(
    (event: MouseEvent) => {
      const shouldSuppress =
        suppressNextDoubleClickRef.current || promotePreview();
      suppressNextDoubleClickRef.current = false;
      if (!shouldSuppress) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    },
    [promotePreview]
  );
  const onPointerDownCapture = useCallback(
    (event: PointerEvent) => {
      wasActiveOnPointerDownRef.current =
        event.button === 0 && props.api.isActive;
      if (!(event.button === 0 && event.detail >= 2 && promotePreview())) {
        return;
      }
      suppressNextDoubleClickRef.current = true;
      // 第二次主键按下时先于 dockview 拖拽状态机固定 preview，避免 dblclick
      // 在 tab 激活/拖拽重排期间丢失；后续 dblclick 由幂等 ref 安全忽略。
      event.preventDefault();
      event.stopPropagation();
    },
    [promotePreview, props.api.isActive]
  );
  // biome a11y: onContextMenu 需要 role。
  // dockview 外层 .dv-tab 是主 Tab 停靠（CSS focus-visible ring 见 globals.css）；
  // 内层保留 role=tab + tabIndex=0 + Enter/Space 合约（终端 refocus），outline 清掉避免双环脏描边。
  const tabContent = (
    <div
      aria-label={tabAriaLabel(tab?.ariaLabel, displayTitle, tab?.state?.label)}
      className="dv-default-tab relative outline-none"
      data-panel-tab-id={props.api.id}
      data-pier-tab-has-active-task={showActiveTaskDot ? "true" : undefined}
      data-pier-tab-kind={
        props.api.component === FILE_PANEL_COMPONENT_ID ? "file" : undefined
      }
      data-pier-tab-preview={isPreview ? "true" : undefined}
      data-tab-state-label={tab?.state?.label}
      data-tab-status={status}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      onPointerDownCapture={onPointerDownCapture}
      role="tab"
      tabIndex={0}
    >
      {showActiveTaskDot ? (
        <span
          aria-label={t("workspace.tab.activeTask")}
          className="pointer-events-none absolute top-1/2 left-1.5 z-10 size-1.5 -translate-y-1/2 rounded-full bg-status-info-fg"
          data-pier-tab-active-task="true"
          role="status"
        />
      ) : null}
      {leadingVisual}
      <span className="dv-default-tab-content">{displayTitle}</span>
      {isDirty ? (
        <span
          aria-label={t("workspace.tab.unsaved")}
          className="size-1.5 shrink-0 rounded-full bg-warning"
          data-pier-tab-dirty="true"
          role="status"
          title={t("workspace.tab.unsaved")}
        />
      ) : null}
      {statusIndicator}
      <button
        aria-label="Close tab"
        className="dv-default-tab-action"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          // 关本 tab，不先 setActive：关 inactive 时保持当前 active（VS Code 语义）；
          // 关 active 时由 closePanel 内邻接 successor 接管。
          actionRegistry.get("pier.panel.close")?.handler({
            sourcePanelId: props.api.id,
            surface: "dockview-tab",
          });
        }}
        onPointerDown={(e) => e.preventDefault()}
        type="button"
      >
        <X className="size-3" />
      </button>
    </div>
  );

  if (!tooltipText) {
    return tabContent;
  }

  return (
    <Tooltip delayDuration={PANEL_TAB_TOOLTIP_DELAY_MS}>
      <TooltipTrigger asChild>{tabContent}</TooltipTrigger>
      <TooltipContent align="center" side="bottom" sideOffset={8}>
        <span className="whitespace-pre-line">{tooltipText}</span>
      </TooltipContent>
    </Tooltip>
  );
}
