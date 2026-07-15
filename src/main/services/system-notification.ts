import type {
  SystemNotificationRequest,
  SystemNotificationResult,
  SystemNotificationUnavailableReason,
} from "@shared/contracts/notification.ts";
import { systemNotificationRequestSchema } from "@shared/contracts/notification.ts";
import { createLogger } from "@shared/logger.ts";
import { Notification } from "electron";

const log = createLogger("system-notification");

/** Keep instances alive so click handlers remain reachable (esp. Windows). */
const liveByTag = new Map<string, Notification>();
const untitledLive = new Set<Notification>();

/**
 * 权限类失败后粘性降级：后续调用直接 shown:false，避免假成功记冷却。
 * Electron 无稳定同步查权限 API；依赖 `failed` 事件学习。
 */
let stickyDenied = false;

const SHOW_SETTLE_MS = 250;

export interface ShowSystemNotificationOptions {
  onClick?: (request: SystemNotificationRequest) => void | Promise<void>;
  /** 通知未能展示（含粘性拒绝）时回调，供 Attention 提示用户看标题栏。 */
  onUnavailable?: (reason: SystemNotificationUnavailableReason) => void;
}

export function resetSystemNotificationPermissionStateForTests(): void {
  stickyDenied = false;
  liveByTag.clear();
  untitledLive.clear();
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
 * 权限拒绝记 sticky，后续不再谎报 shown:true。
 */
export async function showSystemNotification(
  raw: SystemNotificationRequest,
  options: ShowSystemNotificationOptions = {}
): Promise<SystemNotificationResult> {
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
    const result = {
      reason: "unsupported" as const,
      shown: false,
    };
    options.onUnavailable?.(result.reason);
    return result;
  }

  if (stickyDenied) {
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

  const notification = new Notification({
    title: request.title,
    ...(request.body ? { body: request.body } : {}),
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

    const timer = setTimeout(() => {
      // 部分平台不保证 show 事件。超时不得乐观 shown:true（会误记 Attention
      // 冷却并跳过权限降级）；未证实展示则 shown:false，不记冷却。
      finish({ reason: "failed", shown: false });
    }, SHOW_SETTLE_MS);

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
    options.onUnavailable?.("denied");
  });

  if (!outcome.shown && outcome.reason && outcome.reason !== "failed") {
    // 超时/瞬时 failed 不弹降级 toast；denied / unsupported / invalid 才提示。
    options.onUnavailable?.(outcome.reason);
  }

  return outcome;
}
