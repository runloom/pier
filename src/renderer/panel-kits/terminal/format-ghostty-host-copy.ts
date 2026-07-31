import {
  classifyGhosttyChildExited,
  defaultDismissModeForExitRole,
  GHOSTTY_HOST_MESSAGE_CATALOG,
  type GhosttyChildExitedVariant,
  primaryI18nKeyForChildExited,
  type TerminalExitDismissMode,
  type TerminalExitPresentation,
  type TerminalExitRole,
} from "@shared/contracts/ghostty-host-copy.ts";
import i18next from "i18next";
import { taskPanelMetadataFromParams } from "@/lib/workspace/task-panel-metadata.ts";
import { taskOutputFromParams } from "@/panel-kits/terminal/panel-params.ts";

function terminalT(key: string, options?: Record<string, unknown>): string {
  // Nested under the default translation resource as `terminal.*`.
  const fullKey = `terminal.${key}`;
  if (options === undefined) {
    return i18next.t(fullKey);
  }
  return i18next.t(fullKey, options);
}

function formatDurationMs(runtimeMs: number): string {
  if (runtimeMs < 1000) {
    return `${Math.max(0, Math.round(runtimeMs))} ms`;
  }
  const seconds = runtimeMs / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
  }
  const minutes = Math.floor(seconds / 60);
  const rem = Math.round(seconds % 60);
  return `${minutes}m ${rem}s`;
}

export interface GhosttyChildExitedBannerCopy {
  dismiss: string;
  primary: string;
  role: TerminalExitRole;
  variant: GhosttyChildExitedVariant;
}

export function exitPresentationFromParams(
  params: unknown
): TerminalExitPresentation | undefined {
  if (
    !params ||
    typeof params !== "object" ||
    !("exitPresentation" in params)
  ) {
    return;
  }
  const raw = (params as { exitPresentation?: unknown }).exitPresentation;
  if (!raw || typeof raw !== "object") {
    return;
  }
  const value = raw as TerminalExitPresentation;
  const out: TerminalExitPresentation = {};
  if (
    typeof value.messageOverride === "string" &&
    value.messageOverride.trim()
  ) {
    out.messageOverride = value.messageOverride.trim();
  }
  if (value.dismissMode === "any-key" || value.dismissMode === "explicit") {
    out.dismissMode = value.dismissMode;
  }
  if (
    value.role === "shell" ||
    value.role === "agent" ||
    value.role === "task" ||
    value.role === "taskOutput"
  ) {
    out.role = value.role;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Prefer live FA, then latch, then agent identity so ultra-fast agent exits
 * still resolve as agent when FA never committed.
 */
export function resolveChildExitedActivityKind(input: {
  agentId?: string | undefined;
  current?: string | undefined;
  latched?: string | undefined;
}): string | undefined {
  if (input.current === "agent" || input.current === "task") {
    return input.current;
  }
  if (input.latched === "agent" || input.latched === "task") {
    return input.latched;
  }
  if (input.agentId) {
    return "agent";
  }
  return input.latched;
}

/**
 * Infer exit role from explicit presentation, task params, then activity kind.
 */
export function inferTerminalExitRole(input: {
  activityKind?: string | undefined;
  exitPresentation?: TerminalExitPresentation | undefined;
  params: unknown;
}): TerminalExitRole {
  if (input.exitPresentation?.role) {
    return input.exitPresentation.role;
  }
  if (taskOutputFromParams(input.params)) {
    return "taskOutput";
  }
  if (taskPanelMetadataFromParams(input.params)) {
    return "task";
  }
  if (input.activityKind === "agent") {
    return "agent";
  }
  if (input.activityKind === "task") {
    return "task";
  }
  return "shell";
}

export function resolveDismissMode(input: {
  exitPresentation?: TerminalExitPresentation | undefined;
  role: TerminalExitRole;
}): TerminalExitDismissMode {
  if (input.exitPresentation?.dismissMode) {
    return input.exitPresentation.dismissMode;
  }
  return defaultDismissModeForExitRole(input.role);
}

/**
 * Resolve localized banner copy for a Ghostty child-exited event.
 * `messageOverride` (params or arg) is already localized when provided.
 */
export function resolveGhosttyChildExitedBanner(input: {
  activityKind?: string | undefined;
  exitCode: number;
  exitPresentation?: TerminalExitPresentation | undefined;
  params?: unknown;
  runtimeMs: number;
}): GhosttyChildExitedBannerCopy {
  const presentation =
    input.exitPresentation ?? exitPresentationFromParams(input.params);
  const role = inferTerminalExitRole({
    activityKind: input.activityKind,
    exitPresentation: presentation,
    params: input.params,
  });
  const variant = classifyGhosttyChildExited(input.exitCode, input.runtimeMs);
  const duration = formatDurationMs(input.runtimeMs);
  const primary =
    presentation?.messageOverride?.trim() ||
    terminalT(primaryI18nKeyForChildExited(variant, role), {
      code: input.exitCode,
      duration,
    });

  const dismissMode = resolveDismissMode({
    exitPresentation: presentation,
    role,
  });
  const dismissKey =
    dismissMode === "explicit"
      ? GHOSTTY_HOST_MESSAGE_CATALOG.processExitedDismissExplicit.i18nKey
      : GHOSTTY_HOST_MESSAGE_CATALOG.processExitedDismissAnyKey.i18nKey;

  return {
    dismiss: terminalT(dismissKey),
    primary,
    role,
    variant,
  };
}

/**
 * Final buffer payload for process-exit inject (renderer-owned i18n).
 * Leading CR+LF matches Ghostty's native print placement.
 */
export function formatGhosttyChildExitedBufferText(input: {
  activityKind?: string | undefined;
  exitCode: number;
  exitPresentation?: TerminalExitPresentation | undefined;
  params?: unknown;
  runtimeMs: number;
}): string {
  const copy = resolveGhosttyChildExitedBanner(input);
  return `\r\n${copy.primary}\r\n${copy.dismiss}`;
}
