/**
 * PWA 叫醒订阅（M2 Task 10，规格 §12）：仅在「standalone + 用户手势」下
 * 订阅 Web Push，把订阅句柄经 notifications.registerPushHandle 上行宿主。
 * iOS 前置：加到主屏幕（standalone）后才暴露 PushManager（见 canSubscribe）。
 */
import { fromBase64Url } from "@shared/crypto/e2e-seal.ts";

/** 是否处于已安装（standalone）显示模式——iOS Web Push 的硬前置。 */
export function isStandalone(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const media = window.matchMedia?.("(display-mode: standalone)").matches;
  const iosStandalone = (
    window.navigator as unknown as { standalone?: boolean }
  ).standalone;
  return Boolean(media || iosStandalone);
}

/** 环境能否订阅：standalone + PushManager 齐备（SW 由调用方确保就绪）。 */
export function canSubscribe(): boolean {
  return isStandalone() && typeof PushManager !== "undefined";
}

export interface PushSubscriptionHandle {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

function encodeKey(buffer: ArrayBuffer | null): string {
  if (buffer === null) {
    return "";
  }
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** 订阅（用户手势内调用）：VAPID 公钥来自宿主 getPushPublicKey。 */
export async function subscribeWebPush(
  vapidPublicKey: string,
  registration?: ServiceWorkerRegistration
): Promise<PushSubscriptionHandle | null> {
  if (!canSubscribe()) {
    return null;
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return null;
  }
  const reg =
    registration ??
    (typeof navigator !== "undefined" && "serviceWorker" in navigator
      ? await navigator.serviceWorker.ready
      : null);
  if (reg === null) {
    return null;
  }
  const subscription = await reg.pushManager.subscribe({
    applicationServerKey: fromBase64Url(vapidPublicKey) as BufferSource,
    userVisibleOnly: true,
  });
  const json = subscription.toJSON() as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
  const endpoint = json.endpoint ?? subscription.endpoint;
  const p256dh = json.keys?.p256dh ?? encodeKey(subscription.getKey("p256dh"));
  const auth = json.keys?.auth ?? encodeKey(subscription.getKey("auth"));
  if (!(endpoint && p256dh && auth)) {
    return null;
  }
  return { endpoint, keys: { auth, p256dh } };
}
