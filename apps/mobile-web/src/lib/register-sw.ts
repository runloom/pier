/**
 * SW 注册 + 存储持久化（M2 Task 10）：注册 sw.js、请求持久化存储
 * （对抗 Safari 七天回收——加到主屏的 PWA 域名豁免，但仍显式请求兜底），
 * 并把 SW 的 notificationclick 深链转成 hash 导航。
 */

export function registerServiceWorker(): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }
  navigator.serviceWorker.register("./sw.js").catch(() => undefined);
  navigator.serviceWorker.addEventListener("message", (event) => {
    const data = event.data as { type?: string; hash?: string } | null;
    if (data?.type === "pier:navigate" && typeof data.hash === "string") {
      window.location.hash = data.hash.replace(/^#/, "");
    }
  });
}

export function requestPersistentStorage(): void {
  navigator.storage?.persist?.().catch(() => undefined);
}
