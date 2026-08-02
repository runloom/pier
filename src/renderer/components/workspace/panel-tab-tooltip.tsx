/**
 * Tooltip / aria / status helpers for Dockview panel tab headers.
 */

import { cn } from "@pier/ui/utils.ts";
import type {
  PanelTabStatus,
  PanelTabTooltip,
} from "@shared/contracts/panel.ts";
import type { ReactNode } from "react";
import {
  runtimeStatusColorClassName,
  runtimeStatusLabel,
  runtimeStatusVisual,
} from "@/components/common/runtime-status-visual.ts";
import type { useT } from "@/i18n/use-t.ts";

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

export function tabTooltipText(
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

export function tabAriaLabel(
  explicit: string | undefined,
  title: string,
  stateLabel: string | undefined,
  trailingLabel?: string | undefined,
  /**
   * Hover-only tooltip body (may include title/state). Extra lines are folded
   * into aria so keyboard/SR keep Command/CWD/path after openOnFocus=false.
   */
  tooltipDetail?: string | null
): string | undefined {
  if (explicit) {
    return explicit;
  }
  const seen = new Set(
    [title, stateLabel, trailingLabel].filter((part): part is string =>
      Boolean(part)
    )
  );
  const tooltipParts = (tooltipDetail ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !seen.has(line));
  const parts = [title, stateLabel, trailingLabel, ...tooltipParts].filter(
    (part): part is string => Boolean(part)
  );
  // 无 state / trailing / tooltip 明细时不要强塞 aria-label（留给外层 title 文本即可）。
  if (parts.length <= 1) {
    return;
  }
  return parts.join(", ");
}

/**
 * Running 态指示 — soft shimmer 顶轨（与状态栏 agent 扫光同语汇）。
 * - dockview tab：视觉在外层 `.dv-tab::before`（与选中线同盒、全宽贴边）；本节点仅 a11y + 状态锚点。
 * - overflow 菜单：无 `.dv-tab`，本节点 `--menu` 自绘同款 shimmer（单节点，无 track/segment 子层）。
 */
function tabRunningTopBar(
  displayLabel: string,
  options?: { preserveSemanticColor?: boolean }
): ReactNode {
  const isMenu = Boolean(options?.preserveSemanticColor);
  return (
    <span
      aria-label={displayLabel}
      className={cn(
        "pier-tab-running-bar pointer-events-none absolute overflow-hidden",
        isMenu && "pier-tab-running-bar--menu"
      )}
      data-panel-tab-state-indicator="running"
      data-tab-status="running"
      role="img"
    />
  );
}

export function tabStatusIndicator(
  status: PanelTabStatus,
  label: string | undefined,
  options?: { preserveSemanticColor?: boolean }
): ReactNode {
  if (status === "idle") {
    return null;
  }
  const displayLabel = label ?? runtimeStatusLabel(status);
  if (status === "running") {
    return tabRunningTopBar(displayLabel, options);
  }
  const visual = runtimeStatusVisual(status);
  const Icon = visual.Icon;
  const textClassName = options?.preserveSemanticColor
    ? runtimeStatusColorClassName(status, "important")
    : visual.textClassName;
  return (
    <span
      aria-label={displayLabel}
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center",
        textClassName
      )}
      data-panel-tab-state-indicator={status}
      data-tab-status={status}
      role="img"
    >
      <Icon
        aria-hidden="true"
        className={cn(
          "size-3 shrink-0",
          visual.iconClassName,
          options?.preserveSemanticColor && textClassName
        )}
        data-panel-tab-state-icon={status}
      />
    </span>
  );
}
