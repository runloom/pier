/**
 * Ghostty 在 Pier 嵌入路径里露给用户的文案目录（终态）。
 *
 * ## 进程退出（主路径）
 * 1. `SHOW_CHILD_EXITED` 返回 true → Ghostty **不** print 英文
 * 2. 事件 → renderer
 * 3. renderer 用 i18n + exitPresentation 拼 **最终字符串**
 * 4. `injectDisplayText` 写入终端 display buffer（write_buffer，非 PTY）
 *
 * ## 启动失败（pty / input / IO）
 * Thread.zig printString 经 0105 patch 调 `ghostty_host_messages_get`
 * （Swift TerminalHostCopy，由 setHostCopyCatalog 推送已本地化模板）。
 * `ioThreadFailed` 可含 `{{error}}`，由 zig 侧替换。
 *
 * ## 粘贴确认
 * NSAlert 读同一 catalog（pasteConfirm*）。
 *
 * 不做 web banner。native **不**做 role 矩阵 / i18n 插值（进程退出）。
 */

/** Ghostty 默认 abnormal 阈值（ms），对齐 Surface.zig / Config.zig。 */
export const GHOSTTY_ABNORMAL_COMMAND_EXIT_RUNTIME_MS = 250;

export type GhosttyHostCopyChannel = "action" | "buffer" | "host";

export type GhosttyHostMessageKind =
  | "processExited"
  | "processExitedFailed"
  | "processExitedAbnormal"
  | "processExitedDismissAnyKey"
  | "processExitedDismissExplicit"
  | "launchFailedTitle"
  | "launchFailedRuntime"
  | "launchFailedExitCode"
  | "launchFailedDismiss"
  | "ptyExhausted"
  | "inputPathFailed"
  | "ioThreadFailed"
  | "ioThreadOom"
  | "pasteConfirmTitle"
  | "pasteConfirmBody"
  | "pasteConfirmAccept"
  | "pasteConfirmCancel";

export interface GhosttyHostMessageDescriptor {
  channel: GhosttyHostCopyChannel;
  ghosttySourceEn: string;
  /** true = Pier 已接管（inject 或 host catalog） */
  hosted: boolean;
  /** `terminal` 命名空间下相对 key */
  i18nKey: string;
  notes?: string;
}

export const GHOSTTY_HOST_MESSAGE_CATALOG: Record<
  GhosttyHostMessageKind,
  GhosttyHostMessageDescriptor
> = {
  processExited: {
    channel: "action",
    ghosttySourceEn: "Process exited. Press any key to close the terminal.",
    hosted: true,
    i18nKey: "ghosttyHost.processExited",
    notes: "renderer 拼最终串 → injectDisplayText",
  },
  processExitedFailed: {
    channel: "action",
    ghosttySourceEn: "Process exited with a non-zero status.",
    hosted: true,
    i18nKey: "ghosttyHost.processExitedFailed",
  },
  processExitedAbnormal: {
    channel: "action",
    ghosttySourceEn:
      "Ghostty failed to launch the requested command: … Press any key to close the window.",
    hosted: true,
    i18nKey: "ghosttyHost.processExitedAbnormal",
  },
  processExitedDismissAnyKey: {
    channel: "action",
    ghosttySourceEn: "Press any key to close the terminal.",
    hosted: true,
    i18nKey: "ghosttyHost.dismissAnyKey",
  },
  processExitedDismissExplicit: {
    channel: "host",
    ghosttySourceEn: "(Pier) Close the tab when finished reviewing.",
    hosted: true,
    i18nKey: "ghosttyHost.dismissExplicit",
  },
  launchFailedTitle: {
    channel: "action",
    ghosttySourceEn: "Ghostty failed to launch the requested command:",
    hosted: true,
    i18nKey: "ghosttyHost.launchFailedTitle",
    notes: "Surface abnormal fallback（action 未消费时）",
  },
  launchFailedRuntime: {
    channel: "action",
    ghosttySourceEn: "Runtime: ",
    hosted: true,
    i18nKey: "ghosttyHost.launchFailedRuntime",
  },
  launchFailedExitCode: {
    channel: "action",
    ghosttySourceEn: "Exit Code: ",
    hosted: true,
    i18nKey: "ghosttyHost.launchFailedExitCode",
  },
  launchFailedDismiss: {
    channel: "action",
    ghosttySourceEn: "Press any key to close the window.",
    hosted: true,
    i18nKey: "ghosttyHost.launchFailedDismiss",
  },
  ptyExhausted: {
    channel: "buffer",
    ghosttySourceEn:
      "Your system cannot allocate any more pty devices. … Please free up some pty devices and try again.",
    hosted: true,
    i18nKey: "ghosttyHost.ptyExhausted",
    notes: "0105 + ghostty_host_messages_get；需 build:libghostty",
  },
  inputPathFailed: {
    channel: "buffer",
    ghosttySourceEn:
      "A configured `input` path was not found… Please review the value of `input`…",
    hosted: true,
    i18nKey: "ghosttyHost.inputPathFailed",
    notes: "0105；需 build:libghostty",
  },
  ioThreadFailed: {
    channel: "buffer",
    ghosttySourceEn:
      "error starting IO thread: … This terminal is non-functional. Please close it and try again.",
    hosted: true,
    i18nKey: "ghosttyHost.ioThreadFailed",
    notes: "支持 {{error}}；0105；需 build:libghostty",
  },
  ioThreadOom: {
    channel: "buffer",
    ghosttySourceEn:
      "Out of memory. This terminal is non-functional. Please close it and try again.",
    hosted: true,
    i18nKey: "ghosttyHost.ioThreadOom",
    notes: "0105；需 build:libghostty",
  },
  pasteConfirmTitle: {
    channel: "host",
    ghosttySourceEn: "Confirm paste into terminal?",
    hosted: true,
    i18nKey: "ghosttyHost.pasteConfirmTitle",
  },
  pasteConfirmBody: {
    channel: "host",
    ghosttySourceEn:
      "This paste contains {{lines}} lines and may run commands immediately.",
    hosted: true,
    i18nKey: "ghosttyHost.pasteConfirmBody",
  },
  pasteConfirmAccept: {
    channel: "host",
    ghosttySourceEn: "Paste",
    hosted: true,
    i18nKey: "ghosttyHost.pasteConfirmAccept",
  },
  pasteConfirmCancel: {
    channel: "host",
    ghosttySourceEn: "Cancel",
    hosted: true,
    i18nKey: "ghosttyHost.pasteConfirmCancel",
  },
};

export type GhosttyChildExitedVariant = "normal" | "failed" | "abnormal";

export type TerminalExitRole = "shell" | "agent" | "task" | "taskOutput";

export type TerminalExitDismissMode = "any-key" | "explicit";

/**
 * 进程退出展示策略（dockview panel params / CreateTerminalArgs）。
 * messageOverride 必须是**已本地化**完整主句。
 */
export interface TerminalExitPresentation {
  dismissMode?: TerminalExitDismissMode;
  messageOverride?: string;
  role?: TerminalExitRole;
}

export function classifyGhosttyChildExited(
  exitCode: number,
  runtimeMs: number,
  abnormalThresholdMs: number = GHOSTTY_ABNORMAL_COMMAND_EXIT_RUNTIME_MS
): GhosttyChildExitedVariant {
  if (runtimeMs <= abnormalThresholdMs) {
    return "abnormal";
  }
  if (exitCode !== 0) {
    return "failed";
  }
  return "normal";
}

const ROLE_PRIMARY_I18N_KEYS: Record<
  TerminalExitRole,
  Record<GhosttyChildExitedVariant, string>
> = {
  shell: {
    normal: GHOSTTY_HOST_MESSAGE_CATALOG.processExited.i18nKey,
    failed: GHOSTTY_HOST_MESSAGE_CATALOG.processExitedFailed.i18nKey,
    abnormal: GHOSTTY_HOST_MESSAGE_CATALOG.processExitedAbnormal.i18nKey,
  },
  agent: {
    normal: "ghosttyHost.agentExited",
    failed: "ghosttyHost.agentExitedFailed",
    abnormal: "ghosttyHost.agentExitedAbnormal",
  },
  task: {
    normal: "ghosttyHost.taskExited",
    failed: "ghosttyHost.taskExitedFailed",
    abnormal: "ghosttyHost.taskExitedAbnormal",
  },
  taskOutput: {
    normal: "ghosttyHost.taskOutputExited",
    failed: "ghosttyHost.taskOutputExitedFailed",
    abnormal: "ghosttyHost.taskOutputExitedAbnormal",
  },
};

export function primaryI18nKeyForChildExited(
  variant: GhosttyChildExitedVariant,
  role: TerminalExitRole = "shell"
): string {
  return ROLE_PRIMARY_I18N_KEYS[role][variant];
}

export function defaultDismissModeForExitRole(
  role: TerminalExitRole
): TerminalExitDismissMode {
  switch (role) {
    case "task":
    case "taskOutput":
    case "agent":
      // 结果查看：显式关 tab / 控制条，不任意键拆 panel/surface
      return "explicit";
    default:
      return "any-key";
  }
}

/** Ghostty child-exited → renderer（仅元数据；文案在 renderer 拼） */
export interface TerminalChildExitedEvent {
  exitCode: number;
  panelId: string;
  runtimeMs: number;
}
