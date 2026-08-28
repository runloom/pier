/**
 * state/hash 路由（不引 react-router）：location.hash 是唯一路由事实，
 * useSyncExternalStore 订阅 hashchange；页面状态（选中 agent 等）走 query。
 */
import { useMemo, useSyncExternalStore } from "react";

export type Route =
  | { page: "pair" }
  | { page: "hosts" }
  | { page: "host" }
  | { page: "session"; agentId: string }
  | { page: "changes" }
  | { page: "files" }
  | { page: "notifications" };

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
      const agentId = params.get("agent") ?? "";
      return agentId.length > 0
        ? { agentId, page: "session" }
        : { page: "host" };
    }
    case "/changes":
      return { page: "changes" };
    case "/files":
      return { page: "files" };
    case "/notifications":
      return { page: "notifications" };
    default:
      return { page: "hosts" };
  }
}

export function routeToHash(route: Route): string {
  switch (route.page) {
    case "session":
      return `#/session?agent=${encodeURIComponent(route.agentId)}`;
    case "hosts":
      return "#/hosts";
    case "pair":
      return "#/pair";
    case "host":
      return "#/host";
    case "changes":
      return "#/changes";
    case "files":
      return "#/files";
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
