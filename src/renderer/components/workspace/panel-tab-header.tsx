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
import type { PanelTabTooltip } from "@shared/contracts/panel.ts";
import type { IDockviewPanelHeaderProps } from "dockview-react";
import { X } from "lucide-react";
import {
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/primitives/tooltip.tsx";
import { useT } from "@/i18n/use-t.ts";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { useContextMenu } from "@/lib/context-menu/use-context-menu.ts";
import { usePanelDescriptorStore } from "@/stores/panel-descriptor.store.ts";
import { useTabShortcutHintsStore } from "@/stores/tab-shortcut-hints.store.ts";
import { resolvePanelTabIcon } from "./panel-tab-icon-registry.ts";

function localizedTooltipLabel(
  label: string,
  t: ReturnType<typeof useT>
): string {
  switch (label) {
    case "Command":
      return t("commandPalette.run.taskTab.tooltip.command");
    case "CWD":
      return t("commandPalette.run.taskTab.tooltip.cwd");
    case "Source":
      return t("commandPalette.run.taskTab.tooltip.source");
    default:
      return label;
  }
}

function localizedTooltipValue(
  label: string,
  value: string,
  t: ReturnType<typeof useT>
): string {
  if (label !== "Source") {
    return value;
  }
  switch (value) {
    case "Cargo":
      return t("commandPalette.run.taskTab.source.cargo");
    case "Recently Run":
      return t("commandPalette.run.taskTab.source.history");
    case "Justfile":
      return t("commandPalette.run.taskTab.source.just");
    case "Makefile":
      return t("commandPalette.run.taskTab.source.make");
    case "mise":
      return t("commandPalette.run.taskTab.source.mise");
    case "package.json":
      return t("commandPalette.run.taskTab.source.packageScript");
    case "pyproject.toml":
      return t("commandPalette.run.taskTab.source.pyproject");
    case "Taskfile":
      return t("commandPalette.run.taskTab.source.taskfile");
    case "VS Code":
      return t("commandPalette.run.taskTab.source.vscode");
    case "Zed":
      return t("commandPalette.run.taskTab.source.zed");
    default:
      return value;
  }
}

function localizedTooltipLine(
  line: { label: string; value: string },
  t: ReturnType<typeof useT>
): string {
  return t("commandPalette.run.taskTab.tooltip.line", {
    label: localizedTooltipLabel(line.label, t),
    value: localizedTooltipValue(line.label, line.value, t),
  });
}

function tabTooltipText(
  tooltip: PanelTabTooltip | undefined,
  fallback: string | undefined,
  t: ReturnType<typeof useT>
): string | null {
  if (!tooltip) {
    return fallback ?? null;
  }
  const lines = [
    tooltip.title,
    ...(tooltip.lines ?? []).map((line) => localizedTooltipLine(line, t)),
  ].filter((line): line is string => Boolean(line));
  return lines.length > 0 ? lines.join("\n") : (fallback ?? null);
}

export function PanelTabHeader(props: IDockviewPanelHeaderProps) {
  const t = useT();
  const [title, setTitle] = useState<string>(props.api.title ?? "");
  const descriptor = usePanelDescriptorStore(
    (state) => state.descriptors[props.api.id]
  );
  const tab = descriptor?.tab;
  const { Icon, iconId } = resolvePanelTabIcon(tab, props.api.component);
  const displayTitle = tab?.title ?? title;
  const tooltipText = tabTooltipText(
    tab?.tooltip,
    descriptor?.display.long ?? descriptor?.display.terminalTitle,
    t
  );
  const shortcutIndex = useTabShortcutHintsStore((state) =>
    state.commandKeyDown ? state.activeGroupTabHints[props.api.id] : undefined
  );
  let leadingVisual: ReactNode = null;
  if (shortcutIndex) {
    leadingVisual = (
      <span
        aria-hidden="true"
        className="pier-panel-tab-index-hint shrink-0 font-semibold text-[10px] text-muted-foreground"
        data-panel-tab-index-hint={shortcutIndex}
      >
        ⌘{shortcutIndex}
      </span>
    );
  } else if (Icon) {
    leadingVisual = (
      <Icon
        aria-hidden="true"
        className="pier-panel-tab-icon shrink-0"
        data-panel-tab-icon={iconId}
      />
    );
  }
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
  const tabContent = (
    <div
      aria-label={tab?.ariaLabel}
      className="dv-default-tab"
      data-panel-tab-id={props.api.id}
      data-tab-busy={
        tab?.state?.busy === undefined ? undefined : String(tab.state.busy)
      }
      data-tab-state-label={tab?.state?.label}
      onContextMenu={onContextMenu}
      role="tab"
      tabIndex={0}
    >
      {leadingVisual}
      <span className="dv-default-tab-content">{displayTitle}</span>
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

  if (!tooltipText) {
    return tabContent;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{tabContent}</TooltipTrigger>
        <TooltipContent align="start" side="bottom" sideOffset={8}>
          <span className="whitespace-pre-line">{tooltipText}</span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
