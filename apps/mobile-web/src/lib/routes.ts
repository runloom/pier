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
  | { page: "changes"; cwd?: string; from?: SessionOrigin }
  | { page: "files"; path?: string; root?: string; from?: SessionOrigin }
  | { page: "notifications" };

/** S2/S3 从会话进入时带回跳身份；工作台入口不带，返回仍是 H2。 */
export interface SessionOrigin {
  panelId: string;
  windowId?: string;
}

function optionalParam(
  params: URLSearchParams,
  key: string
): string | undefined {
  const value = params.get(key);
  return value !== null && value.length > 0 ? value : undefined;
}

function sessionOriginFromParams(
  params: URLSearchParams
): SessionOrigin | undefined {
  const panelId = optionalParam(params, "fromPanel");
  if (panelId === undefined) {
    return;
  }
  const windowId = optionalParam(params, "fromWindow");
  return windowId === undefined ? { panelId } : { panelId, windowId };
}

function writeSessionOrigin(
  params: URLSearchParams,
  from: SessionOrigin | undefined
): void {
  if (from === undefined) {
    return;
  }
  params.set("fromPanel", from.panelId);
  if (from.windowId !== undefined) {
    params.set("fromWindow", from.windowId);
  }
}

function hashWithQuery(path: string, params: URLSearchParams): string {
  const query = params.toString();
  return query.length > 0 ? `#${path}?${query}` : `#${path}`;
}

/** S2/S3 顶栏返回：有会话来源则回 S1，否则回工作台。 */
export function projectionBack(
  route: Extract<Route, { page: "changes" | "files" }>
): Route {
  const from = route.from;
  if (from === undefined) {
    return { page: "host" };
  }
  return {
    page: "session",
    panelId: from.panelId,
    ...(from.windowId === undefined ? {} : { windowId: from.windowId }),
  };
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
      const from = sessionOriginFromParams(params);
      return {
        page: "changes",
        ...(cwd === undefined ? {} : { cwd }),
        ...(from === undefined ? {} : { from }),
      };
    }
    case "/files": {
      const root = optionalParam(params, "root");
      const filePath = optionalParam(params, "path");
      const from = sessionOriginFromParams(params);
      return {
        page: "files",
        ...(root === undefined ? {} : { root }),
        ...(filePath === undefined ? {} : { path: filePath }),
        ...(from === undefined ? {} : { from }),
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
    case "changes": {
      const params = new URLSearchParams();
      if (route.cwd !== undefined) {
        params.set("cwd", route.cwd);
      }
      writeSessionOrigin(params, route.from);
      return hashWithQuery("/changes", params);
    }
    case "files": {
      const params = new URLSearchParams();
      if (route.root !== undefined) {
        params.set("root", route.root);
      }
      if (route.path !== undefined) {
        params.set("path", route.path);
      }
      writeSessionOrigin(params, route.from);
      return hashWithQuery("/files", params);
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
