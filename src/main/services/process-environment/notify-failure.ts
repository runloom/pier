/**
 * Shell-env resolve failure notify pipeline.
 *
 * Ingest only when Pier has a focused key-window (matches NCS
 * `hasFocusedPierWindow` / `resolveDeliveryPlan`). Pending until first focus.
 * Process-once + per-boot dedupeKey; never expands OS_ELIGIBLE_KINDS.
 */
import type { NotificationReport } from "@shared/contracts/notification-center.ts";
import { createLogger } from "@shared/logger.ts";
import type { ProcessEnvironmentDiagnostics } from "./types.ts";

const log = createLogger("process-env.notify");

const TITLE_KEY = "notificationsCenter.shellEnv.failedTitle";
const BODY_KEY = "notificationsCenter.shellEnv.failedBody";
const OPEN_SETTINGS_LABEL_KEY = "notificationsCenter.shellEnv.openSettings";

/** Static prefix; full key is per-boot via `shellEnvFailureDedupeKey`. */
export const SHELL_ENV_FAILURE_DEDUPE_KEY_PREFIX = "shell-env:resolve-failed";

/** @deprecated Prefer shellEnvFailureDedupeKey(bootId). Kept for governance scans. */
export const SHELL_ENV_FAILURE_DEDUPE_KEY = SHELL_ENV_FAILURE_DEDUPE_KEY_PREFIX;

export type ShellEnvUiLocale = "en" | "zh-CN";

export function shellEnvFailureDedupeKey(bootId: string): string {
  return `${SHELL_ENV_FAILURE_DEDUPE_KEY_PREFIX}:${bootId}`;
}

/** Match renderer `notificationsCenter.shellEnv.*` (main has no i18n runtime). */
const DETAIL_MAX_CHARS = 280;

function sanitizeFailureDetail(detail: string): string {
  const oneLine = detail
    .replaceAll("\r", " ")
    .replaceAll("\n", " ")
    .replaceAll("\0", "")
    .replaceAll(/\s+/g, " ")
    .trim();
  if (oneLine.length <= DETAIL_MAX_CHARS) {
    return oneLine;
  }
  return `${oneLine.slice(0, DETAIL_MAX_CHARS - 1)}…`;
}

export function formatShellEnvFailureCopy(
  locale: ShellEnvUiLocale,
  detail?: string | undefined
): {
  body: string;
  title: string;
} {
  const detailLine = detail?.trim() ? sanitizeFailureDetail(detail) : undefined;
  if (locale === "zh-CN") {
    const base =
      "任务和智能体可能使用与终端不同的 Node 或 PATH。请打开设置 → 终端查看状态，并确认 shell 在非交互启动时不会卡住或弹提示。";
    return {
      body: detailLine ? `${base}\n\n原因：${detailLine}` : base,
      title: "无法加载 shell 环境",
    };
  }
  const base =
    "Tasks and agents may use a different Node or PATH than your terminal. Open Settings → Terminal to check status, or make sure your shell starts cleanly without prompts.";
  return {
    body: detailLine ? `${base}\n\nCause: ${detailLine}` : base,
    title: "Couldn't load shell environment",
  };
}

export interface ShellEnvFailureNotifyDeps {
  /** Process-start identity so each launch is a distinct NCS health row. */
  bootId: string;
  getFocusedWindow: () => unknown | null;
  ingest: (report: NotificationReport) => void;
  /**
   * Resolved UI strings (main has no i18n; app-core supplies from prefs locale).
   * Receives failure diagnostics so body can include the concrete error.
   */
  resolveCopy: (
    diagnostics: ProcessEnvironmentDiagnostics
  ) =>
    | { body: string; title: string }
    | Promise<{ body: string; title: string }>;
}

export interface ShellEnvFailureNotifyController {
  /** Test / diagnostics. */
  isPending(): boolean;
  /** Wire to PES `onShellEnvFailed` — only entry that schedules delivery. */
  onShellEnvFailed: (diagnostics: ProcessEnvironmentDiagnostics) => void;
  /** Call on window create + focus when a key-window may exist. */
  tryDeliver: () => void;
  wasDelivered(): boolean;
}

export function buildShellEnvFailureReport(
  copy: {
    body: string;
    title: string;
  },
  bootId: string
): NotificationReport {
  return {
    actions: [
      {
        id: "open-settings",
        labelKey: OPEN_SETTINGS_LABEL_KEY,
      },
    ],
    actionParams: { section: "terminal" },
    body: copy.body,
    dedupeKey: shellEnvFailureDedupeKey(bootId),
    kind: "channel.health",
    severity: "warning",
    source: "host",
    title: copy.title,
    titleKey: TITLE_KEY,
    trigger: "system-event",
  };
}

export function createShellEnvFailureNotify(
  deps: ShellEnvFailureNotifyDeps
): ShellEnvFailureNotifyController {
  let pendingDiagnostics: ProcessEnvironmentDiagnostics | null = null;
  let delivered = false;
  let delivering = false;

  function tryDeliver(): void {
    if (delivered || delivering || !pendingDiagnostics) {
      return;
    }
    if (deps.getFocusedWindow() == null) {
      return;
    }
    const diagnostics = pendingDiagnostics;
    delivering = true;
    Promise.resolve()
      .then(async () => {
        const copy = await deps.resolveCopy(diagnostics);
        if (delivered || !pendingDiagnostics) {
          return;
        }
        if (deps.getFocusedWindow() == null) {
          return;
        }
        deps.ingest(buildShellEnvFailureReport(copy, deps.bootId));
        delivered = true;
        pendingDiagnostics = null;
      })
      .catch((err: unknown) => {
        log.warn("shell env failure notify failed", { err });
      })
      .finally(() => {
        delivering = false;
      });
  }

  return {
    onShellEnvFailed(diagnostics) {
      if (delivered) {
        return;
      }
      pendingDiagnostics = diagnostics;
      tryDeliver();
    },
    tryDeliver,
    isPending: () => pendingDiagnostics !== null && !delivered,
    wasDelivered: () => delivered,
  };
}

// Re-export keys for i18n registration / tests.
export const shellEnvFailureCopyKeys = {
  bodyKey: BODY_KEY,
  openSettingsLabelKey: OPEN_SETTINGS_LABEL_KEY,
  titleKey: TITLE_KEY,
} as const;
