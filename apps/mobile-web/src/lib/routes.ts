/**
 * state/hash 路由（不引 react-router）：location.hash 是唯一路由事实，
 * useSyncExternalStore 订阅 hashchange；页面状态（选中 agent 等）走 query。
 */
import { useMemo, useSyncExternalStore } from "react";

export type Route =
  | { page: "pair" }
  | { page: "hosts" }
  | { page: "host" }
  /**
   * 会话地址 = panelId + 可选 windowId。
   * panelId 跨窗口不唯一；深链缺 window 时仅在快照里恰好一命中才打开。
   * 宿主 Web Push：`/session?panel=<panelId>&window=<windowId>`。
   * 不用 agentId（claude / codex 等产品名）——多开同款智能体会撞车。
   */
  | { page: "session"; panelId: string; windowId?: string }
  | { page: "changes"; cwd?: string }
  | { page: "files"; path?: string; root?: string }
  | { page: "notifications" };

function optionalParam(
  params: URLSearchParams,
  key: string
): string | undefined {
  const value = params.get(key);
  return value !== null && value.length > 0 ? value : undefined;
}

/** 解析 hash；空/未知 hash 回落 H1 主机列表。 */
export function parseHash(hash: string): Route {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const [path, query = ""] = raw.split("?");
  const params = new URLSearchParams(query);
  switch (path) {
    case "/pair":
      return { page: "pair" };
    case "/host":
      return { page: "host" };
    case "/session": {
      const panelId = params.get("panel") ?? "";
      const windowId = optionalParam(params, "window");
      return panelId.length > 0
        ? {
            page: "session",
            panelId,
            ...(windowId === undefined ? {} : { windowId }),
          }
        : { page: "host" };
    }
    case "/changes": {
      const cwd = optionalParam(params, "cwd");
      return cwd === undefined ? { page: "changes" } : { page: "changes", cwd };
    }
    case "/files": {
      const root = optionalParam(params, "root");
      const filePath = optionalParam(params, "path");
      return {
        page: "files",
        ...(root === undefined ? {} : { root }),
        ...(filePath === undefined ? {} : { path: filePath }),
      };
    }
    case "/notifications":
      return { page: "notifications" };
    default:
      return { page: "hosts" };
  }
}

export function routeToHash(route: Route): string {
  switch (route.page) {
    case "session": {
      const panel = encodeURIComponent(route.panelId);
      return route.windowId === undefined
        ? `#/session?panel=${panel}`
        : `#/session?panel=${panel}&window=${encodeURIComponent(route.windowId)}`;
    }
    case "hosts":
      return "#/hosts";
    case "pair":
      return "#/pair";
    case "host":
      return "#/host";
    case "changes":
      return route.cwd === undefined
        ? "#/changes"
        : `#/changes?cwd=${encodeURIComponent(route.cwd)}`;
    case "files": {
      const params = new URLSearchParams();
      if (route.root !== undefined) {
        params.set("root", route.root);
      }
      if (route.path !== undefined) {
        params.set("path", route.path);
      }
      const query = params.toString();
      return query.length > 0 ? `#/files?${query}` : "#/files";
    }
    case "notifications":
      return "#/notifications";
    default:
      return "#/hosts";
  }
}

export function navigate(route: Route): void {
  window.location.hash = routeToHash(route);
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
  };
}
export function useHashRoute(): Route {
  // getSnapshot 必须返回稳定值：以 hash 字符串为缓存键，memo 解析结果
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  return useMemo(() => parseHash(hash), [hash]);
}
