/**
 * 壳顶栏：返回（可选）+ 页面标题 + 帧客户端连接状态镜像。
 */
import type { Route } from "../lib/routes.ts";
import { navigate } from "../lib/routes.ts";
import { useMobileWebStore } from "../lib/store.ts";

export const CONNECTION_STATUS_LABEL: Record<string, string> = {
  idle: "未连接",
  connecting: "连接中…",
  connected: "已连接",
  reconnecting: "重连中…",
  closed: "已断开",
};

export function TopBar(props: { title: string; back?: Route }) {
  const connection = useMobileWebStore((state) => state.connection);
  const back = props.back;
  const label = CONNECTION_STATUS_LABEL[connection] ?? connection;
  let tone = "text-neutral-400";
  if (connection === "connected") {
    tone = "text-emerald-400";
  } else if (connection === "reconnecting" || connection === "connecting") {
    tone = "text-amber-400";
  }
  return (
    <header className="flex items-center gap-3 border-neutral-800 border-b px-4 py-3">
      {back !== undefined && (
        <button
          className="text-neutral-300 text-sm"
          data-testid="topbar-back"
          onClick={() => {
            navigate(back);
          }}
          type="button"
        >
          ‹ 返回
        </button>
      )}
      <h1 className="flex-1 font-semibold text-base">{props.title}</h1>
      <span className={`text-xs ${tone}`} data-testid="connection-status">
        {label}
      </span>
    </header>
  );
}
