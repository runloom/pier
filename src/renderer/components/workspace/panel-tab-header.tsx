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

import { Tooltip, TooltipContent, TooltipTrigger } from "@pier/ui/tooltip.tsx";
import { agentKindFromTabIconId } from "@shared/contracts/agent-session.ts";
import type {
  PanelTabStatus,
  PanelTabTooltip,
} from "@shared/contracts/panel.ts";
import type { IDockviewPanelHeaderProps } from "dockview-react";
import { X } from "lucide-react";
import {
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from "react";
import { AgentIcon } from "@/components/agent-icons/index.tsx";
import {
  runtimeStatusLabel,
  runtimeStatusVisual,
} from "@/components/common/runtime-status-visual.ts";
import { useT } from "@/i18n/use-t.ts";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { useContextMenu } from "@/lib/context-menu/use-context-menu.ts";
import { usePanelDescriptorStore } from "@/stores/panel-descriptor.store.ts";
import { useTabShortcutHintsStore } from "@/stores/terminal.store.ts";
import { resolvePanelTabIcon } from "./panel-tab-icon-registry.ts";

export const PANEL_TAB_TOOLTIP_DELAY_MS = 1000;

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
    case "Composer":
      return t("commandPalette.run.taskTab.source.composer");
    case "Deno":
      return t("commandPalette.run.taskTab.source.deno");
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
  stateLabel: string | undefined,
  t: ReturnType<typeof useT>
): string | null {
  if (!tooltip) {
    const lines = [fallback, stateLabel].filter((line): line is string =>
      Boolean(line)
    );
    return lines.length > 0 ? lines.join("\n") : null;
  }
  const lines = [
    tooltip.title,
    stateLabel,
    ...(tooltip.lines ?? []).map((line) => localizedTooltipLine(line, t)),
  ].filter((line): line is string => Boolean(line));
  return lines.length > 0 ? lines.join("\n") : (fallback ?? null);
}

function tabAriaLabel(
  explicit: string | undefined,
  title: string,
  stateLabel: string | undefined
): string | undefined {
  if (explicit) {
    return explicit;
  }
  if (!stateLabel) {
    return;
  }
  return [title, stateLabel].filter(Boolean).join(", ");
}

function tabStatusIndicator(
  status: PanelTabStatus,
  label: string | undefined
): ReactNode {
  if (status === "idle") {
    return null;
  }
  const displayLabel = label ?? runtimeStatusLabel(status);
  const visual = runtimeStatusVisual(status);
  const Icon = visual.Icon;
  return (
    <span
      aria-label={displayLabel}
      className={`inline-flex size-4 shrink-0 items-center justify-center ${visual.textClassName}`}
      data-panel-tab-state-indicator={status}
      data-tab-status={status}
      role="img"
      title={displayLabel}
    >
      <Icon
        aria-hidden="true"
        className={`size-3 shrink-0 ${visual.iconClassName}`}
        data-panel-tab-state-icon={status}
      />
    </span>
  );
}

export function PanelTabHeader(props: IDockviewPanelHeaderProps) {
  const t = useT();
  const [title, setTitle] = useState<string>(props.api.title ?? "");
  const descriptor = usePanelDescriptorStore(
    (state) => state.descriptors[props.api.id]
  );
  const tab = descriptor?.tab;
  const { Icon, iconId } = resolvePanelTabIcon(tab, props.api.component);
  const agentKind = agentKindFromTabIconId(tab?.icon?.id);
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
  const commandKeyDown = useTabShortcutHintsStore(
    (state) => state.commandKeyDown
  );
  const shortcutIndex = useTabShortcutHintsStore((state) =>
    commandKeyDown ? state.activeGroupTabHints[props.api.id] : undefined
  );
  let leadingVisual: ReactNode = null;
  if (shortcutIndex) {
    leadingVisual = (
      <span
        aria-hidden="true"
        className="pier-panel-tab-index-hint shrink-0 font-semibold text-[10px] text-primary"
        data-panel-tab-index-hint={shortcutIndex}
      >
        ⌘{shortcutIndex}
      </span>
    );
  } else if (agentKind) {
    leadingVisual = (
      <span
        aria-hidden="true"
        className="flex shrink-0 items-center"
        data-panel-tab-icon={tab?.icon?.id}
      >
        <AgentIcon agentId={agentKind} size={14} />
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
      aria-label={tabAriaLabel(tab?.ariaLabel, displayTitle, tab?.state?.label)}
      className="dv-default-tab relative"
      data-panel-tab-id={props.api.id}
      data-tab-state-label={tab?.state?.label}
      data-tab-status={status}
      onContextMenu={onContextMenu}
      role="tab"
      tabIndex={0}
    >
      {leadingVisual}
      <span className="dv-default-tab-content">{displayTitle}</span>
      {statusIndicator}
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

  if (!(tooltipText && !commandKeyDown)) {
    return tabContent;
  }

  return (
    <Tooltip delayDuration={PANEL_TAB_TOOLTIP_DELAY_MS}>
      <TooltipTrigger asChild>{tabContent}</TooltipTrigger>
      <TooltipContent align="start" side="bottom" sideOffset={8}>
        <span className="whitespace-pre-line">{tooltipText}</span>
      </TooltipContent>
    </Tooltip>
  );
}
