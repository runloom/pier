import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AGENT_ATTENTION_TEST_KIND } from "@shared/contracts/agent-attention.ts";
import type {
  OpenSystemNotificationSettingsResult,
  SystemNotificationPermissionSnapshot,
  SystemNotificationPermissionSource,
  SystemNotificationPermissionStatus,
  SystemNotificationRequest,
  SystemNotificationResult,
  SystemNotificationUnavailableReason,
} from "@shared/contracts/notification.ts";
import { systemNotificationRequestSchema } from "@shared/contracts/notification.ts";
import { createLogger } from "@shared/logger.ts";
import { Notification, shell } from "electron";

const log = createLogger("system-notification");
const execFileAsync = promisify(execFile);

/** Keep instances alive so click handlers remain reachable (esp. Windows). */
const liveByTag = new Map<string, Notification>();
const untitledLive = new Set<Notification>();

/**
 * 权限类失败后粘性降级：普通路径直接 shown:false。
 * 用户强制探测（测试通知）可 bypass 一次真正 show。
 */
let stickyDenied = false;
let permissionStatus: SystemNotificationPermissionStatus = "unknown";
let permissionObservedAt = 0;
let permissionSource: SystemNotificationPermissionSource = "boot";

/** 普通 Attention 投递：短超时，避免误记冷却。 */
const SHOW_SETTLE_MS = 250;
/** 用户强制探测：macOS 常不发 show 事件或较晚；无 failed 则视为已投递。 */
const FORCE_PROBE_SETTLE_MS = 2000;

export interface ShowSystemNotificationOptions {
  /**
   * 用户发起的强制探测：忽略 stickyDenied 一次，真正调用 Notification.show。
   * 仅测试通知等自检路径使用；Attention 业务路径不得传 true。
   */
  forceProbe?: boolean;
  onClick?: (request: SystemNotificationRequest) => void | Promise<void>;
  /** 权限快照更新后回调（设置页订阅）。 */
  onPermissionChanged?: (
    snapshot: SystemNotificationPermissionSnapshot
  ) => void;
  /** 通知未能展示（含粘性拒绝）时回调，供 Attention 提示用户看标题栏。 */
  onUnavailable?: (reason: SystemNotificationUnavailableReason) => void;
}

export function resetSystemNotificationPermissionStateForTests(): void {
  stickyDenied = false;
  permissionStatus = "unknown";
  permissionObservedAt = 0;
  permissionSource = "boot";
  liveByTag.clear();
  untitledLive.clear();
}

export function getSystemNotificationPermissionSnapshot(): SystemNotificationPermissionSnapshot {
  if (!Notification.isSupported()) {
    return {
      observedAt: Date.now(),
      source: "cached",
      status: "unsupported",
    };
  }
  return {
    observedAt: permissionObservedAt || Date.now(),
    source: permissionSource,
    status: permissionStatus,
  };
}

function recordPermission(
  status: SystemNotificationPermissionStatus,
  source: SystemNotificationPermissionSource,
  onPermissionChanged?: (snapshot: SystemNotificationPermissionSnapshot) => void
): void {
  permissionStatus = status;
  permissionSource = source;
  permissionObservedAt = Date.now();
  onPermissionChanged?.(getSystemNotificationPermissionSnapshot());
}

function isPermissionFailure(error: string): boolean {
  const normalized = error.toLowerCase();
  return (
    normalized.includes("permission") ||
    normalized.includes("denied") ||
    normalized.includes("not authorized") ||
    normalized.includes("notallowed") ||
    normalized.includes("not allowed") ||
    normalized.includes("authorization") ||
    normalized.includes("unotifications")
  );
}

/**
 * 展示系统通知。异步等待 `show` / `failed`（短超时兜底），
 * 权限拒绝记 sticky；forceProbe 可 bypass sticky 一次。
 */
export async function showSystemNotification(
  raw: SystemNotificationRequest,
  options: ShowSystemNotificationOptions = {}
): Promise<SystemNotificationResult> {
  const deliverySource: SystemNotificationPermissionSource = options.forceProbe
    ? "forced-probe"
    : "attention-delivery";

  const parsed = systemNotificationRequestSchema.safeParse(raw);
  if (!parsed.success) {
    log.warn("invalid system notification request", {
      issues: parsed.error.issues,
    });
    const result = {
      reason: "invalid" as const,
      shown: false,
    };
    options.onUnavailable?.(result.reason);
    return result;
  }
  const request = parsed.data;

  if (!Notification.isSupported()) {
    recordPermission(
      "unsupported",
      deliverySource,
      options.onPermissionChanged
    );
    const result = {
      reason: "unsupported" as const,
      shown: false,
    };
    options.onUnavailable?.(result.reason);
    return result;
  }

  if (stickyDenied && !options.forceProbe) {
    recordPermission("denied", "cached", options.onPermissionChanged);
    const result = {
      reason: "denied" as const,
      shown: false,
    };
    options.onUnavailable?.(result.reason);
    return result;
  }

  if (request.tag) {
    const previous = liveByTag.get(request.tag);
    if (previous) {
      try {
        previous.close();
      } catch {
        // ignore close failures; replace path continues
      }
      liveByTag.delete(request.tag);
    }
  }

  const isTestKind = request.kind === AGENT_ATTENTION_TEST_KIND;
  const notification = new Notification({
    title: request.title,
    silent: false,
    ...(request.body ? { body: request.body } : {}),
    ...(isTestKind && process.platform === "darwin"
      ? { subtitle: "Pier" }
      : {}),
  });

  if (request.tag) {
    liveByTag.set(request.tag, notification);
  } else {
    untitledLive.add(notification);
  }

  notification.on("click", () => {
    if (!options.onClick) {
      return;
    }
    Promise.resolve(options.onClick(request)).catch((err: unknown) => {
      log.error("notification click handler failed", { err });
    });
  });

  notification.on("close", () => {
    if (request.tag && liveByTag.get(request.tag) === notification) {
      liveByTag.delete(request.tag);
    }
    untitledLive.delete(notification);
  });

  const outcome = await new Promise<SystemNotificationResult>((resolve) => {
    let settled = false;
    const finish = (result: SystemNotificationResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    notification.once("failed", (_event: unknown, error: string) => {
      if (isPermissionFailure(error)) {
        stickyDenied = true;
        finish({ reason: "denied", shown: false });
        return;
      }
      finish({ reason: "failed", shown: false });
    });
    notification.once("show", () => {
      finish({ shown: true });
    });

    const timer = setTimeout(
      () => {
        // 部分平台（尤其 macOS）不保证 show 事件。
        // 业务 Attention：超时 = 未证实展示，不记冷却。
        // 用户 forceProbe：show() 未抛错且未 failed → 视为已投递给系统。
        if (options.forceProbe) {
          finish({ shown: true });
          return;
        }
        finish({ reason: "failed", shown: false });
      },
      options.forceProbe ? FORCE_PROBE_SETTLE_MS : SHOW_SETTLE_MS
    );

    try {
      notification.show();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isPermissionFailure(message)) {
        stickyDenied = true;
        finish({ reason: "denied", shown: false });
      } else {
        finish({ reason: "failed", shown: false });
      }
    }
  });

  // 超时后迟到的权限失败：粘性降级 + 补发 unavailable（本次结果不改写）。
  notification.once("failed", (_event: unknown, error: string) => {
    if (!isPermissionFailure(error)) {
      return;
    }
    stickyDenied = true;
    recordPermission("denied", deliverySource, options.onPermissionChanged);
    options.onUnavailable?.("denied");
  });

  if (outcome.shown) {
    stickyDenied = false;
    recordPermission("authorized", deliverySource, options.onPermissionChanged);
  } else if (outcome.reason === "denied") {
    recordPermission("denied", deliverySource, options.onPermissionChanged);
  }

  if (!outcome.shown && outcome.reason && outcome.reason !== "failed") {
    options.onUnavailable?.(outcome.reason);
  }

  return outcome;
}

/** 设置页「发送测试通知」：forceProbe，不携带业务 agentRef。 */
export async function showTestSystemNotification(
  options: Omit<ShowSystemNotificationOptions, "forceProbe"> = {}
): Promise<SystemNotificationResult> {
  return showSystemNotification(
    {
      body: "If you see this banner or Notification Center item, delivery works.",
      kind: AGENT_ATTENTION_TEST_KIND,
      tag: `${AGENT_ATTENTION_TEST_KIND}:${Date.now()}`,
      title: "Pier test notification",
    },
    {
      ...options,
      forceProbe: true,
    }
  );
}

/**
 * 尽力打开系统通知偏好。失败返回 opened:false，由 UI 展示手动路径。
 */
export async function openSystemNotificationSettings(): Promise<OpenSystemNotificationSettingsResult> {
  try {
    if (process.platform === "darwin") {
      // 不要用 shell.openExternal 打开 x-apple.systempreferences：
      // Electron/dev 壳下可能落到 Electron 默认页（空壳），而不是系统设置。
      // 用系统 open(1) 交给 LaunchServices 更稳。
      const candidates = [
        [
          "x-apple.systempreferences:com.apple.Notifications-Settings.extension",
        ],
        ["x-apple.systempreferences:com.apple.preference.notifications"],
        ["-b", "com.apple.systempreferences"],
      ];
      for (const args of candidates) {
        try {
          await execFileAsync("open", args);
          return { opened: true };
        } catch (err) {
          log.debug("open notification settings candidate failed", {
            args,
            err,
          });
        }
      }
      return { opened: false, reason: "open-failed" };
    }
    if (process.platform === "win32") {
      await shell.openExternal("ms-settings:notifications");
      return { opened: true };
    }
    return {
      opened: false,
      reason: "unsupported-platform",
    };
  } catch (err) {
    log.warn("open system notification settings failed", { err });
    return {
      opened: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
