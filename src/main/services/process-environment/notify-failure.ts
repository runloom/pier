/**
 * Shell-env resolve soft-degrade surface.
 *
 * Industry practice (VS Code / JetBrains): dump failure must not block the app;
 * use process.env and continue. Pier product default goes further for quiet UX:
 * **no toast, no notification-center row** — diagnostics live in
 * Settings → Terminal (`hostDiagnostics`) and structured logs only.
 *
 * Optional report builders remain for tests / future opt-in alerts.
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
const DETAIL_MAX_CHARS = 800;

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
      "Pier 未能从登录 shell 读取完整 PATH，已改用基础环境继续运行。任务和智能体可能找不到 nvm 或 Homebrew 安装的工具。可到「设置 → 终端」查看状态并重新加载。";
    return {
      body: detailLine ? `${base}\n\n详情：${detailLine}` : base,
      title: "任务环境可能与终端不同",
    };
  }
  const base =
    "Pier could not read the full PATH from your login shell and is using a basic environment instead. Tasks and agents may not find tools from nvm or Homebrew. Open Settings → Terminal to check status and reload.";
  return {
    body: detailLine ? `${base}\n\nDetails: ${detailLine}` : base,
    title: "Task environment may differ from the terminal",
  };
}

export interface ShellEnvFailureNotifyDeps {
  /** Process-start identity (logs / future opt-in dedupe). */
  bootId: string;
}

export interface ShellEnvFailureNotifyController {
  /** Test / diagnostics. */
  isPending(): boolean;
  /** Wire to PES `onShellEnvFailed` — log once; never NCS by default. */
  onShellEnvFailed: (diagnostics: ProcessEnvironmentDiagnostics) => void;
  /** No-op; kept so boot/focus hooks stay safe if reintroduced. */
  tryDeliver: () => void;
  wasDelivered(): boolean;
}

/**
 * Optional report shape for tests / future opt-in. Production default does not
 * call NCS ingest (see createShellEnvFailureNotify).
 */
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
    severity: "info",
    source: "host",
    suppressToast: true,
    title: copy.title,
    titleKey: TITLE_KEY,
    trigger: "system-event",
  };
}

/**
 * Product default: process-once structured log only.
 * Settings → Terminal reads host diagnostics for user-facing status.
 */
export function createShellEnvFailureNotify(
  deps: ShellEnvFailureNotifyDeps
): ShellEnvFailureNotifyController {
  let logged = false;

  return {
    onShellEnvFailed(diagnostics) {
      if (logged) {
        return;
      }
      logged = true;
      log.warn("shell environment degraded; using process env", {
        bootId: deps.bootId,
        cwd: diagnostics.cwd,
        dumpMode: diagnostics.dumpMode,
        error: diagnostics.error,
        shell: diagnostics.shell,
        source: diagnostics.source,
      });
    },
    tryDeliver() {
      // Intentionally empty: no NCS / toast delivery in product default.
    },
    isPending: () => false,
    wasDelivered: () => logged,
  };
}

// Re-export keys for i18n registration / tests.
export const shellEnvFailureCopyKeys = {
  bodyKey: BODY_KEY,
  openSettingsLabelKey: OPEN_SETTINGS_LABEL_KEY,
  titleKey: TITLE_KEY,
} as const;
