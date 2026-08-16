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
import { useContextMenu } from "@/lib/context-menu/use-menu.ts";
import { parseFilesDiskSourceFromParams } from "@/lib/files/disk-source.ts";
import { terminalTabTitleClampOsc } from "@/panel-kits/terminal/tab-chrome.ts";
import { ensureTuiInputFocus } from "@/panel-kits/terminal/tui-input-focus.ts";
import {
  selectDisambiguatedFileTabTitle,
  useFileTabLabelsStore,
} from "@/stores/file-tab-labels.store.ts";
import { usePanelDescriptorStore } from "@/stores/panel-descriptor.store.ts";
import {
  panelHasActiveTaskRun,
  useTaskRunsStore,
} from "@/stores/task-runs.store.ts";
import { terminalComposerTakeoverFocus } from "@/stores/terminal-composer-takeover.ts";
import { requestTerminalFocusIntent } from "@/stores/terminal-input-routing-slice.ts";
import {
  type PanelTabFileParams,
  panelTabKind,
  panelTabParamsIsDirty,
  panelTabParamsIsPreview,
} from "./panel-tab-layout.ts";
import { PanelTabLeadingIcon } from "./panel-tab-leading-icon.tsx";
import {
  PANEL_TAB_TOOLTIP_DELAY_MS,
  tabAriaLabel,
  tabStatusIndicator,
  tabTooltipText,
} from "./panel-tab-tooltip.tsx";
import {
  PanelTabTrailingView,
  panelTabTrailingAriaSuffix,
} from "./panel-tab-trailing.tsx";

export { PANEL_TAB_TOOLTIP_DELAY_MS } from "./panel-tab-tooltip.tsx";

export function PanelTabHeader(props: IDockviewPanelHeaderProps) {
  const t = useT();
  const [title, setTitle] = useState<string>(props.api.title ?? "");
  const [isPreview, setIsPreview] = useState<boolean>(() =>
    panelTabParamsIsPreview(
      props.api.component,
      props.params as PanelTabFileParams | undefined
    )
  );
  const [isDirty, setIsDirty] = useState<boolean>(() =>
    panelTabParamsIsDirty(
      props.api.component,
      props.params as PanelTabFileParams | undefined
    )
  );
  // 真 group id；禁止回退 panel.id（否则同组路径消歧永远不触发）。
  const [groupId, setGroupId] = useState<string | null>(
    () => props.api.group?.id ?? null
  );
  // disk 身份本地状态：与 dirty/preview 一样跟 onDidParametersChange，避免 Save As 陈旧。
  const initialDisk = parseFilesDiskSourceFromParams(props.params);
  const [diskPath, setDiskPath] = useState<string | null>(
    () => initialDisk?.path ?? null
  );
  const [diskRoot, setDiskRoot] = useState<string | null>(
    () => initialDisk?.root ?? null
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
  const registeredIdentity = useFileTabLabelsStore(
    (state) => state.byId[props.api.id]
  );
  const disambiguatedFileTitle = useFileTabLabelsStore((state) =>
    selectDisambiguatedFileTabTitle(state, props.api.id)
  );
  const registerFileTab = useFileTabLabelsStore((state) => state.register);
  const unregisterFileTab = useFileTabLabelsStore((state) => state.unregister);
  const tab = descriptor?.tab;
  const kind = panelTabKind(props.api.component);
  const baseTitle = tab?.title ?? title;
  // store 身份与 live disk 一致时才用消歧标题，避免 rename 后陈旧后缀盖住 basename。
  const storeMatchesLive =
    registeredIdentity !== undefined &&
    diskPath !== null &&
    diskRoot !== null &&
    registeredIdentity.path === diskPath &&
    registeredIdentity.root === diskRoot;
  const displayTitle =
    storeMatchesLive && disambiguatedFileTitle
      ? disambiguatedFileTitle
      : baseTitle;
  const titleClampOsc = terminalTabTitleClampOsc({
    component: props.api.component,
    tabChromeTitle: tab?.title,
    terminalTitle: descriptor?.display.terminalTitle,
  });
  const trailingAria = panelTabTrailingAriaSuffix(tab?.trailing);
  // Every tab must have a hover tooltip: structured chrome → long path → short title.
  const tooltipText = tabTooltipText(
    tab?.tooltip,
    descriptor?.display.long ?? descriptor?.display.terminalTitle,
    tab?.state?.label,
    t,
    displayTitle
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
    setGroupId(props.api.group?.id ?? null);
    // 测试 mock / 旧 api 可能无 onDidGroupChange；运行时 dockview 必有。
    const onDidGroupChange = props.api.onDidGroupChange?.bind(props.api);
    if (!onDidGroupChange) {
      return;
    }
    const disposable = onDidGroupChange(() => {
      setGroupId(props.api.group?.id ?? null);
    });
    return () => {
      disposable.dispose();
    };
  }, [props.api]);

  useEffect(() => {
    // params 变更：preview / dirty / disk source（Save As、rename）同一管道。
    const applyParams = (params: unknown) => {
      const nextIsPreview = panelTabParamsIsPreview(
        props.api.component,
        params as PanelTabFileParams | undefined
      );
      isPreviewRef.current = nextIsPreview;
      setIsPreview(nextIsPreview);
      setIsDirty(
        panelTabParamsIsDirty(
          props.api.component,
          params as PanelTabFileParams | undefined
        )
      );
      const disk = parseFilesDiskSourceFromParams(params);
      setDiskPath(disk?.path ?? null);
      setDiskRoot(disk?.root ?? null);
    };
    applyParams(props.params);
    const disposable = props.api.onDidParametersChange((next) => {
      applyParams(next);
    });
    return () => {
      disposable.dispose();
    };
  }, [props.api, props.params]);

  // 注册：身份变化只 register（store sameIdentity 短路），禁止 cleanup unregister 闪 peer 标题。
  useEffect(() => {
    if (kind !== "file" || !(diskPath && diskRoot && groupId)) {
      unregisterFileTab(props.api.id);
      return;
    }
    registerFileTab(props.api.id, {
      groupId,
      path: diskPath,
      root: diskRoot,
    });
  }, [
    diskPath,
    diskRoot,
    groupId,
    kind,
    props.api.id,
    registerFileTab,
    unregisterFileTab,
  ]);

  // 卸载才从消歧表移除。
  useEffect(() => {
    const panelId = props.api.id;
    return () => {
      unregisterFileTab(panelId);
    };
  }, [props.api.id, unregisterFileTab]);

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
  // 锚在图标+标题上，不要整颗 tab（含 × / trailing）。`.dv-default-tab` 是
  // width:100%，以整 tab 为 trigger 会把短标题 tip 推到文字右侧。
  const titleLabel = (
    <span className="flex h-full min-w-0 items-center gap-1 self-stretch">
      {leadingVisual}
      <span className="dv-default-tab-content">{displayTitle}</span>
    </span>
  );
  const titleCluster = tooltipText ? (
    <Tooltip delayDuration={PANEL_TAB_TOOLTIP_DELAY_MS}>
      {/*
       * Tab 条只走 hover delay。Radix focus 会即时 open，快捷键切 tab /
       * 程序化 focus 会误弹出；tooltip 明细已并入 aria-label。
       * Provider skipDelayDuration（workspace host）使已打开时跨 tab 滑过
       * 跳过 delay，直接切到新 tab 文案，而不是先关再等。
       */}
      <TooltipTrigger asChild openOnFocus={false}>
        {titleLabel}
      </TooltipTrigger>
      <TooltipContent
        align="center"
        // Full title for hover: wider than default max-w-64, wrap instead of
        // single-line ellipsis (tab short may CSS-truncate; tooltip must not).
        className="max-w-[min(92vw,40rem)] items-start whitespace-normal text-left"
        side="bottom"
      >
        <span className="block max-w-full whitespace-pre-wrap break-words">
          {tooltipText}
        </span>
      </TooltipContent>
    </Tooltip>
  ) : (
    titleLabel
  );

  // biome a11y: onContextMenu 需要 role。
  // dockview 外层 .dv-tab 是主 Tab 停靠（CSS focus-visible ring 见 globals.css）；
  // 内层保留 role=tab + tabIndex=0 + Enter/Space 合约（终端 refocus），outline 清掉避免双环脏描边。
  return (
    <div
      aria-label={tabAriaLabel(
        tab?.ariaLabel,
        displayTitle,
        tab?.state?.label,
        trailingAria,
        tooltipText
      )}
      className="dv-default-tab relative outline-none"
      data-panel-tab-id={props.api.id}
      data-pier-tab-has-active-task={showActiveTaskDot ? "true" : undefined}
      data-pier-tab-kind={kind}
      data-pier-tab-preview={isPreview ? "true" : undefined}
      data-pier-tab-title-clamp={titleClampOsc ? "osc" : undefined}
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
          className="pointer-events-none absolute top-1/2 left-1 z-10 size-1.5 -translate-y-1/2 rounded-full bg-status-info-fg"
          data-pier-tab-active-task="true"
          role="status"
        />
      ) : null}
      {titleCluster}
      <PanelTabTrailingView trailing={tab?.trailing} />
      {isDirty ? (
        <span
          aria-label={t("workspace.tab.unsaved")}
          className="size-1.5 shrink-0 rounded-full bg-warning"
          data-pier-tab-dirty="true"
          role="status"
        />
      ) : null}
      {statusIndicator}
      <button
        aria-label={t("workspace.tab.close")}
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
}
