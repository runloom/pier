/**
 * 全局连接状态横幅：投影必须诚实——与宿主的连接断开时，所有投影页
 * （工作台/会话/变更/文件/通知）明示「内容可能不是最新」，重连由客户端
 * 指数退避自愈（规格 §9.1），恢复后横幅自动消失。
 * H0 配对页无连接语义、H1 主机列表自带三态在线视图，二者不显示。
 */
import { navigate, useHashRoute } from "../lib/routes.ts";
import { useMobileWebStore } from "../lib/store.ts";

export function ConnectionBanner() {
  const route = useHashRoute();
  const connection = useMobileWebStore((state) => state.connection);
  if (route.page === "pair" || route.page === "hosts") {
    return null;
  }
  if (connection === "connected" || connection === "idle") {
    return null;
  }
  if (connection === "closed") {
    return (
      <div
        className="flex items-center justify-between gap-3 bg-red-950/80 px-4 py-2 text-red-200 text-xs"
        data-testid="connection-banner"
        role="alert"
      >
        <span>连接已关闭。若这台电脑已吊销本设备，请重新扫码配对。</span>
        <button
          className="shrink-0 underline"
          data-testid="connection-banner-hosts"
          onClick={() => {
            navigate({ page: "hosts" });
          }}
          type="button"
        >
          返回主机列表
        </button>
      </div>
    );
  }
  const reconnecting = connection === "reconnecting";
  return (
    <div
      className={
        reconnecting
          ? "bg-amber-950/70 px-4 py-2 text-amber-300 text-xs"
          : "bg-neutral-900 px-4 py-2 text-neutral-400 text-xs"
      }
      data-testid="connection-banner"
      role="status"
    >
      {reconnecting
        ? "与这台电脑的连接已断开，正在自动重连…当前显示的内容可能不是最新。长时间未恢复请回主机列表检查"
        : "正在连接这台电脑…"}
    </div>
  );
}
