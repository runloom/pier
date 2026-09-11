import { type ReactNode, useState } from "react";
import {
  cx,
  IconButton,
  NavAction,
  NavBar,
  PhoneShell,
  QuietEmpty,
} from "./chrome.tsx";
import { Icon } from "./icons.tsx";
import type { DemoNotification, DemoSession, PushState } from "./model.ts";

/** 通知保留事件发生时的标题、详情和时间，不用当前终端覆盖历史事件。 */
/** 「暂不」只在可点原型里记住，静态帧每次都展示开启卡。 */
const PUSH_DISMISS_KEY = "pier.mobile-web.push-dismissed";

function readPushDismissed(): boolean {
  return globalThis.localStorage?.getItem(PUSH_DISMISS_KEY) === "1";
}

export function NotificationsScreen(props: {
  hostName: string;
  items: readonly DemoNotification[];
  onBack?: (() => void) | undefined;
  onEnablePush?: (() => void) | undefined;
  onOpen?: ((item: DemoNotification) => void) | undefined;
  onRead?: ((id: string) => void) | undefined;
  onReadAll?: (() => void) | undefined;
  onRefresh?: (() => void) | undefined;
  /** 可点原型记住「暂不」；静态帧不要持久化，否则自查帧会被上次点击吃掉。 */
  persistPushDismiss?: boolean | undefined;
  push: PushState;
  refreshing?: boolean | undefined;
  sessions?: readonly DemoSession[] | undefined;
}): ReactNode {
  const unread = props.items.filter((item) => !item.read).length;
  const [pushDismissed, setPushDismissed] = useState(
    () => (props.persistPushDismiss === true ? readPushDismissed() : false)
  );
  const dismissPush = () => {
    setPushDismissed(true);
    if (props.persistPushDismiss === true) {
      globalThis.localStorage?.setItem(PUSH_DISMISS_KEY, "1");
    }
  };
  const reopenPush = () => {
    setPushDismissed(false);
    if (props.persistPushDismiss === true) {
      globalThis.localStorage?.removeItem(PUSH_DISMISS_KEY);
    }
  };
  return (
    <PhoneShell
      nav={
        <NavBar
          back={{ label: "这台电脑", onClick: props.onBack }}
          layout="split"
          subtitle={<span>{props.hostName}</span>}
          title="收件箱"
          trailing={
            <span className="flex items-center">
              {props.onRefresh === undefined ? null : (
                <IconButton
                  icon="refresh"
                  label="刷新通知"
                  onClick={props.onRefresh}
                  spinning={props.refreshing === true}
                />
              )}
              {unread > 0 && props.onReadAll !== undefined ? (
                <NavAction onClick={props.onReadAll}>全部已读</NavAction>
              ) : undefined}
            </span>
          }
        />
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pt-5 pb-8 [scrollbar-width:thin]">
        {pushDismissed &&
        props.onEnablePush !== undefined &&
        props.push !== "done" ? (
          <button
            className="flex min-h-11 items-center self-start px-1 text-[13px] text-action-accent active:opacity-70"
            onClick={reopenPush}
            type="button"
          >
            开启通知提醒
          </button>
        ) : null}
        {props.onEnablePush === undefined ||
        props.push === "done" ||
        pushDismissed ? null : (
          <div className="rounded-2xl border border-border/70 bg-card px-4 py-2">
            <div className="flex items-center gap-3">
              <span className="flex-1 text-[13px] text-muted-foreground leading-5">
                离开页面后，也能收到提醒
              </span>
              <button
                className="min-h-11 px-2 text-[13px] text-muted-foreground active:opacity-70"
                onClick={dismissPush}
                type="button"
              >
                暂不
              </button>
              <button
                className="min-h-11 px-2 text-[13px] text-action-accent active:opacity-70 disabled:opacity-50"
                disabled={props.push === "busy"}
                onClick={props.onEnablePush}
                type="button"
              >
                {props.push === "busy"
                  ? "开启中…"
                  : props.push === "failed"
                    ? "重试"
                    : "开启"}
              </button>
            </div>
            {props.push === "failed" ? (
              <p
                className="pb-1 text-[12px] text-status-warning-fg leading-[18px]"
                role="status"
              >
                没有开启成功。请在浏览器或系统设置里允许通知；iPhone
                需要先把本页添加到主屏幕。
              </p>
            ) : null}
          </div>
        )}
        {props.items.length === 0 ? (
          <QuietEmpty
            title="暂时没有通知"
            body="智能体需要你处理或完成回合时，消息会出现在这里。"
          />
        ) : (
          <>
            <p className="px-1 text-[13px] text-muted-foreground">
              {unread > 0 ? `${unread} 条未读` : "全部已读"}
            </p>
            <div className="flex flex-col gap-2.5">
              {props.items.map((item) => {
                const session = props.sessions?.find(
                  (s) => s.id === item.sessionId
                );
                return (
                  <button
                    className="min-h-11 w-full rounded-2xl border border-border/70 bg-card px-4 py-4 text-left active:bg-interactive-active"
                    key={item.id}
                    onClick={() => {
                      if (item.sessionId !== null && props.onOpen !== undefined)
                        props.onOpen(item);
                      else props.onRead?.(item.id);
                    }}
                    type="button"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={cx(
                          "min-w-0 flex-1 text-[15px] leading-5",
                          item.read ? "font-medium" : "font-semibold"
                        )}
                      >
                        {item.title}
                      </span>
                      {item.read ? null : (
                        <span
                          aria-label="未读"
                          className="size-1.5 shrink-0 rounded-full bg-action-danger"
                        />
                      )}
                      <span className="shrink-0 text-[12px] text-muted-foreground">
                        {item.when}
                      </span>
                    </span>
                    <span className="mt-2 block text-[13px] text-muted-foreground leading-[21px] [overflow-wrap:anywhere]">
                      {item.body}
                    </span>
                    <span className="mt-3 flex items-center justify-between gap-3 text-[12px] text-muted-foreground">
                      <span className="truncate">
                        {session === undefined
                          ? (item.sessionTitle ?? "这台电脑")
                          : `${session.title} · ${session.agent ?? "终端"}`}
                      </span>
                      {item.sessionId === null ? null : session === undefined ? (
                        <span className="flex shrink-0 items-center gap-1">
                          会话已结束 · 查看详情
                          <Icon className="size-3.5" name="chevron-right" />
                        </span>
                      ) : (
                        <span className="flex shrink-0 items-center gap-1">
                          查看会话
                          <Icon className="size-3.5" name="chevron-right" />
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </PhoneShell>
  );
}
