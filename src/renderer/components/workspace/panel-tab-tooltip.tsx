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

export function tabStatusIndicator(
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
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center",
        visual.textClassName
      )}
      data-panel-tab-state-indicator={status}
      data-tab-status={status}
      role="img"
      title={displayLabel}
    >
      <Icon
        aria-hidden="true"
        className={cn("size-3 shrink-0", visual.iconClassName)}
        data-panel-tab-state-icon={status}
      />
    </span>
  );
}
