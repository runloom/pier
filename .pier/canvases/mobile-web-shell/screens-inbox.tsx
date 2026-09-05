import type { ReactNode } from "react";
import { cx, NavAction, NavBar, PhoneShell, QuietEmpty } from "./chrome.tsx";
import { Icon } from "./icons.tsx";
import type { DemoNotification, DemoSession, PushState } from "./model.ts";

/** 通知保留事件发生时的标题、详情和时间，不用当前终端覆盖历史事件。 */
export function NotificationsScreen(props: {
  hostName: string;
  items: readonly DemoNotification[];
  onBack?: (() => void) | undefined;
  onEnablePush?: (() => void) | undefined;
  onOpen?: ((item: DemoNotification) => void) | undefined;
  onRead?: ((id: string) => void) | undefined;
  onReadAll?: (() => void) | undefined;
  push: PushState;
  sessions?: readonly DemoSession[] | undefined;
}): ReactNode {
  const unread = props.items.filter((item) => !item.read).length;
  return (
    <PhoneShell
      nav={
        <NavBar
          back={{ label: props.hostName, onClick: props.onBack }}
          backIconOnly
          layout="split"
          subtitle={<span>{props.hostName}</span>}
          title="收件箱"
          trailing={
            unread > 0 && props.onReadAll !== undefined ? (
              <NavAction onClick={props.onReadAll}>全部已读</NavAction>
            ) : undefined
          }
        />
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pt-5 pb-8 [scrollbar-width:thin]">
        {props.onEnablePush === undefined || props.push === "done" ? null : (
          <div className="flex items-center gap-3 rounded-2xl border border-border/70 bg-card px-4 py-2">
            <span className="flex-1 text-[13px] text-muted-foreground leading-5">
              离开页面后，也能收到提醒
            </span>
            <button
              className="min-h-11 px-2 text-[13px] text-action-accent active:opacity-70 disabled:opacity-50"
              disabled={props.push === "busy"}
              onClick={props.onEnablePush}
              type="button"
            >
              {props.push === "busy" ? "开启中…" : "开启"}
            </button>
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
                    className="w-full rounded-2xl border border-border/70 bg-card px-4 py-4 text-left active:bg-interactive-active"
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
                          ? "这台电脑"
                          : `${session.title} · ${session.agent ?? "终端"}`}
                      </span>
                      {item.sessionId === null ? null : (
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
