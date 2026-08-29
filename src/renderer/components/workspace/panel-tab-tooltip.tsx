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

/** First-hover wait before a tab tooltip opens (ms). */
export const PANEL_TAB_TOOLTIP_DELAY_MS = 400;
/**
 * After a tab tooltip was open, how long the user may enter another tab
 * trigger without paying the open delay again (Radix `skipDelayDuration`).
 * Keeps tooltip visible-feeling when sweeping across the tab strip.
 */
export const PANEL_TAB_TOOLTIP_SKIP_DELAY_MS = 500;

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
    case "CMake":
      return t("commandPalette.run.taskTab.source.cmake");
    case "Composer":
      return t("commandPalette.run.taskTab.source.composer");
    case "Deno":
      return t("commandPalette.run.taskTab.source.deno");
    case ".NET":
      return t("commandPalette.run.taskTab.source.dotnet");
    case "Go":
      return t("commandPalette.run.taskTab.source.go");
    case "Gradle":
      return t("commandPalette.run.taskTab.source.gradle");
    case "Recently Run":
      return t("commandPalette.run.taskTab.source.history");
    case "Justfile":
      return t("commandPalette.run.taskTab.source.just");
    case "Makefile":
      return t("commandPalette.run.taskTab.source.make");
    case "Maven":
      return t("commandPalette.run.taskTab.source.maven");
    case "mise":
      return t("commandPalette.run.taskTab.source.mise");
    case "Mix":
      return t("commandPalette.run.taskTab.source.mix");
    case "package.json":
      return t("commandPalette.run.taskTab.source.packageScript");
    case "pubspec":
      return t("commandPalette.run.taskTab.source.pubspec");
    case "pyproject.toml":
      return t("commandPalette.run.taskTab.source.pyproject");
    case "sbt":
      return t("commandPalette.run.taskTab.source.sbt");
    case "Swift Package":
      return t("commandPalette.run.taskTab.source.swiftpm");
    case "Taskfile":
      return t("commandPalette.run.taskTab.source.taskfile");
    case "VS Code":
      return t("commandPalette.run.taskTab.source.vscode");
    case "Zed":
      return t("commandPalette.run.taskTab.source.zed");
    case "Zig":
      return t("commandPalette.run.taskTab.source.zig");
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

/**
 * Build hover tooltip body for a dockview tab.
 *
 * Gold standard: every tab shows a tooltip. Prefer structured `tab.tooltip`,
 * then long/detail fallbacks, then the short tab title (always last resort).
 */
export function tabTooltipText(
  tooltip: PanelTabTooltip | undefined,
  fallback: string | undefined,
  stateLabel: string | undefined,
  t: ReturnType<typeof useT>,
  shortTitle?: string | undefined
): string | null {
  if (!tooltip) {
    const lines = [fallback, stateLabel, shortTitle].filter(
      (line): line is string => Boolean(line && line.length > 0)
    );
    // Dedupe when fallback === shortTitle；路径 long 已含叶子时去掉重复 short。
    const unique = [...new Set(lines)].filter((line) => {
      if (line !== shortTitle || !fallback || !shortTitle) {
        return true;
      }
      return !(
        fallback.endsWith(`/${shortTitle}`) ||
        fallback.endsWith(`\\${shortTitle}`)
      );
    });
    return unique.length > 0 ? unique.join("\n") : null;
  }
  const lines = [
    tooltip.title,
    stateLabel,
    ...(tooltip.lines ?? []).map((line) => localizedTooltipLine(line, t)),
  ].filter((line): line is string => Boolean(line));
  if (lines.length > 0) {
    return lines.join("\n");
  }
  const rest = [fallback, shortTitle].filter((line): line is string =>
    Boolean(line && line.length > 0)
  );
  const unique = [...new Set(rest)];
  return unique.length > 0 ? unique.join("\n") : null;
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
 * 仅 dockview tab：视觉在 `.pier-tab-running-bar`（不占竖分割线 ::before）。
 * overflow 列表不得复用顶轨 loading（见 `surface: "menu"`）。
 */
function tabRunningTopBar(displayLabel: string): ReactNode {
  return (
    <span
      aria-label={displayLabel}
      className="pier-tab-running-bar pointer-events-none absolute"
      data-panel-tab-state-indicator="running"
      data-tab-status="running"
      role="img"
    />
  );
}

function tabStatusIcon(
  status: Exclude<PanelTabStatus, "idle">,
  displayLabel: string,
  importantColor: boolean
): ReactNode {
  const visual = runtimeStatusVisual(status);
  const Icon = visual.Icon;
  const textClassName = importantColor
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
          importantColor && textClassName
        )}
        data-panel-tab-state-icon={status}
      />
    </span>
  );
}

/**
 * @param surface `"tab"` (default) uses the strip top-shimmer bar for running.
 *   `"menu"` uses a compact spinner/icon — never the tab-strip loading chrome.
 */
export function tabStatusIndicator(
  status: PanelTabStatus,
  label: string | undefined,
  options?: { surface?: "tab" | "menu" }
): ReactNode {
  if (status === "idle") {
    return null;
  }
  const displayLabel = label ?? runtimeStatusLabel(status);
  const surface = options?.surface ?? "tab";
  if (status === "running" && surface === "tab") {
    return tabRunningTopBar(displayLabel);
  }
  return tabStatusIcon(status, displayLabel, surface === "menu");
}
