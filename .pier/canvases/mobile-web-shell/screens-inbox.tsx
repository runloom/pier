import type { ReactNode } from "react";
import { NavBar, PhoneShell, QuietEmpty, SessionSlice } from "./chrome.tsx";
import {
  type DemoNotification,
  type DemoSession,
  type PushState,
  inboxThreads,
} from "./model.ts";

/**
 * N1 当前机收件箱。只列本机会话线程，复用工作台切片（更短）；
 * 需要你处理钉顶。主机级系统句不进这一面。
 */
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
  const threads = inboxThreads(props.items, props.sessions ?? []);
  const sessionThreads = threads.filter((thread) => thread.sessionId !== null);
  return (
    <PhoneShell
      nav={
        <NavBar
          back={{ label: props.hostName, onClick: props.onBack }}
          backIconOnly
          layout="split"
          title="收件箱"
          trailing={undefined}
        />
      }
    >
      {props.onEnablePush === undefined ? null : (
        <PushHint onEnable={props.onEnablePush} state={props.push} />
      )}
      {sessionThreads.length === 0 ? (
        <QuietEmpty
          body="这台电脑上需要你处理的会话和刚结束的回合会出现在这里。"
          title="没有需要看的会话"
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-8 [scrollbar-width:none]">
          {sessionThreads.map((thread) => {
            const session = (props.sessions ?? []).find(
              (item) => item.id === thread.sessionId
            );
            if (session === undefined) {
              return null;
            }
            return (
              <SessionSlice
                key={thread.key}
                maxLines={thread.waiting ? 5 : 4}
                onOpen={() => {
                  openThread(props, thread.latest);
                }}
                session={session}
              />
            );
          })}
        </div>
      )}
    </PhoneShell>
  );
}

function openThread(
  props: {
    onOpen?: ((item: DemoNotification) => void) | undefined;
    onRead?: ((id: string) => void) | undefined;
  },
  item: DemoNotification
): void {
  if (item.sessionId === null) {
    props.onRead?.(item.id);
    return;
  }
  props.onOpen?.(item);
}

function PushHint(props: {
  onEnable?: (() => void) | undefined;
  state: PushState;
}): ReactNode {
  if (props.state === "done") {
    return (
      <p className="px-4 pt-1 pb-2 text-[12px] text-muted-foreground leading-4">
        已开启离线提醒
      </p>
    );
  }
  const busy = props.state === "busy";
  return (
    <div className="flex items-center justify-between gap-3 px-4 pt-1 pb-2">
      <p className="text-[12px] text-muted-foreground leading-4">
        离线时也可提醒
      </p>
      <button
        className="min-h-11 px-1 text-[13px] text-muted-foreground leading-5 transition-colors duration-75 active:bg-interactive-active disabled:opacity-50"
        disabled={busy}
        onClick={props.onEnable}
        type="button"
      >
        {busy ? "开启中…" : "开启"}
      </button>
    </div>
  );
}
