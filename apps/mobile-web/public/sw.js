/**
 * Pier 移动端 Service Worker（M2 Task 10）：只做三件事——
 *   1. push：展示宿主直发的 Web Push（标题/详情/深链来自 payload）；
 *   2. notificationclick：聚焦已开窗或打开新窗到深链（主机 → 会话 / 通知）；
 *   3. 版本升级 skipWaiting + clients.claim。
 * 无 fetch 缓存（v1 避免静态资源陈旧；帧契约不依赖 SW——服务端设计 §10.3）。
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  const title = payload.title || "Pier";
  const body = payload.body || "";
  const path = typeof payload.path === "string" ? payload.path : "/";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      data: { path },
      tag: payload.dedupeKey || undefined,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = event.notification.data?.path || "/";
  const targetHash = `#${path}`;
  event.waitUntil(
    self.clients
      .matchAll({ includeUncontrolled: true, type: "window" })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client) {
            client.postMessage({ hash: targetHash, type: "pier:navigate" });
            return client.focus();
          }
        }
        return self.clients.openWindow(`./${targetHash}`);
      })
  );
});
