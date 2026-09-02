/**
 * Web 壳路由壳：state/hash 路由串起七面（H0 配对 / H1 主机 / H2 工作台 /
 * S1 会话 / S2 变更 / S3 文件 / N1 通知）。启动时静默回连最近配对宿主，
 * control.watch 快照与连接状态经 store 分发给各页；每页自含顶栏（返回 +
 * 连接状态）。
 */
import { useEffect } from "react";
import { ConnectionBanner } from "./components/connection-banner.tsx";
import type { Route } from "./lib/routes.ts";
import { useHashRoute } from "./lib/routes.ts";
import { autoConnectLatestHost, resumeActiveHost } from "./lib/session.ts";
import { ChangesPage } from "./pages/changes.tsx";
import { FilesPage } from "./pages/files.tsx";
import { HostPage } from "./pages/host.tsx";
import { HostsPage } from "./pages/hosts.tsx";
import { NotificationsPage } from "./pages/notifications.tsx";
import { PairPage } from "./pages/pair.tsx";
import { SessionPage } from "./pages/session.tsx";

function CurrentPage({ route }: { route: Route }) {
  switch (route.page) {
    case "pair":
      return <PairPage />;
    case "hosts":
      return <HostsPage />;
    case "host":
      return <HostPage />;
    case "session":
      return <SessionPage />;
    case "changes":
      return <ChangesPage />;
    case "files":
      return <FilesPage />;
    case "notifications":
      return <NotificationsPage />;
    default:
      return <HostsPage />;
  }
}

export function App() {
  const route = useHashRoute();

  useEffect(() => {
    autoConnectLatestHost().catch(() => undefined);
    // §9.1：回到前台立即重拨/拉最新快照，不等退避定时器醒来。
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        resumeActiveHost().catch(() => undefined);
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return (
    <>
      <ConnectionBanner />
      <CurrentPage route={route} />
    </>
  );
}
