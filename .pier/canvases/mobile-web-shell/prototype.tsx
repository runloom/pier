import { type ReactNode, useEffect, useReducer, useRef, useState } from "react";
import {
  demoKeyDelivery,
  type DemoNotification,
  type DemoState,
  INITIAL_DEMO,
  notificationsOf,
  reduceDemo,
  sessionsOf,
  unreadCount,
} from "./model.ts";
import { NavStack, type StackEntry } from "./nav-stack.tsx";
import { repoScope, worktreeIsDirty } from "./repo.ts";
import { HostsScreen, PairScreen } from "./screens-hosts.tsx";
import { NotificationsScreen } from "./screens-inbox.tsx";
import { ChangesScreen, FilesScreen } from "./screens-review.tsx";
import { SessionScreen } from "./screens-session.tsx";
import { HostScreen } from "./screens-workbench.tsx";

type Frame =
  | { kind: "hosts" }
  | { kind: "pair" }
  | { kind: "workbench"; hostId: string }
  | { kind: "inbox"; hostId: string }
  | { kind: "session"; sessionId: string }
  | { kind: "changes"; worktree: string }
  | { kind: "files"; sessionId: string };

const PUSH_ENABLE_MS = 1200;

function frameTitle(frame: Frame, demo: DemoState): string {
  switch (frame.kind) {
    case "hosts":
      return "主机";
    case "pair":
      return "添加主机";
    case "workbench":
      return (
        demo.hosts.find((host) => host.id === frame.hostId)?.name ?? "这台电脑"
      );
    case "inbox":
      return "通知";
    case "session":
      return (
        demo.sessions.find((session) => session.id === frame.sessionId)
          ?.title ?? "会话"
      );
    case "changes":
      return "变更";
    case "files":
      return "文件";
    default:
      return "";
  }
}

/**
 * P0 可点原型：一条栈，没有底栏。主机 → 这台电脑 → 会话 → 变更 / 文件；
 * 主机 → 添加主机；工作台铃铛 → 通知 → 该会话。
 * 闭环：配对加入主机；进入先连接再在线；按键投递只确认已发送；通知点开落到会话并标已读；底部面板切同机其它终端；离线机点按后可移除。
 */
export function PrototypePhone(): ReactNode {
  const [demo, dispatch] = useReducer(reduceDemo, INITIAL_DEMO);
  const [stack, setStack] = useState<StackEntry<Frame>[]>([
    { frame: { kind: "hosts" }, id: 0 },
  ]);
  const nextId = useRef(1);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(
    () => () => {
      for (const timer of timers.current) {
        clearTimeout(timer);
      }
      timers.current.clear();
    },
    []
  );

  const later = (ms: number, run: () => void) => {
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      run();
    }, ms);
    timers.current.add(timer);
  };

  // 返回标签在推入时定下：出场层滑出期间也保持原样。
  const backLabels = useRef(new Map<number, string>());

  const push = (frame: Frame) => {
    const id = nextId.current;
    nextId.current += 1;
    const top = stack[stack.length - 1];
    backLabels.current.set(
      id,
      top === undefined ? "返回" : frameTitle(top.frame, demo)
    );
    setStack((current) => [...current, { frame, id }]);
  };
  const pop = () => {
    setStack((current) =>
      current.length > 1 ? current.slice(0, -1) : current
    );
  };

  const openNotification = (item: DemoNotification) => {
    dispatch({ id: item.id, type: "notification.read" });
    if (item.sessionId !== null) {
      push({ kind: "session", sessionId: item.sessionId });
    }
  };

  const enablePush = () => {
    dispatch({ state: "busy", type: "push.set" });
    later(PUSH_ENABLE_MS, () => {
      dispatch({ state: "done", type: "push.set" });
    });
  };

  const render = (frame: Frame, entry: StackEntry<Frame>): ReactNode => {
    const backLabel = backLabels.current.get(entry.id) ?? "返回";

    switch (frame.kind) {
      case "pair":
        return (
          <PairScreen
            onBack={pop}
            onPaired={(host) => {
              dispatch({ host, type: "host.add" });
              pop();
            }}
          />
        );
      case "workbench": {
        const host = demo.hosts.find((item) => item.id === frame.hostId);
        if (host === undefined) {
          return null;
        }
        return (
          <HostScreen
            connectOnMount
            host={host}
            onBack={pop}
            onOpenChanges={(worktree) => {
              push({ kind: "changes", worktree });
            }}
            onOpenInbox={() => {
              push({ hostId: host.id, kind: "inbox" });
            }}
            onOpenSession={(sessionId) => {
              push({ kind: "session", sessionId });
            }}
            sessions={sessionsOf(demo, host.id)}
            unread={unreadCount(notificationsOf(demo, host.id))}
          />
        );
      }
      case "inbox":
        return (
          <NotificationsScreen
            hostName={backLabel}
            items={notificationsOf(demo, frame.hostId)}
            onBack={pop}
            onEnablePush={enablePush}
            onOpen={openNotification}
            onRead={(id) => {
              dispatch({ id, type: "notification.read" });
            }}
            onReadAll={() => {
              dispatch({ type: "notification.readAll" });
            }}
            push={demo.push}
            sessions={sessionsOf(demo, frame.hostId)}
          />
        );
      case "session": {
        const session = demo.sessions.find(
          (item) => item.id === frame.sessionId
        );
        if (session === undefined) {
          return null;
        }
        return (
          <SessionScreen
            backLabel={backLabel}
            dirty={session.hasGit && worktreeIsDirty(session.worktree)}
            onBack={pop}
            onOpenChanges={
              session.hasGit
                ? () => {
                    push({ kind: "changes", worktree: session.worktree });
                  }
                : undefined
            }
            onOpenFiles={() => {
              push({ kind: "files", sessionId: session.id });
            }}
            onRespond={(_key, interactionId) =>
              demoKeyDelivery(session, interactionId)
            }
            onSwitchSession={(sessionId) => {
              setStack((current) => {
                const top = current[current.length - 1];
                if (top === undefined || top.frame.kind !== "session") {
                  return current;
                }
                return [
                  ...current.slice(0, -1),
                  { frame: { kind: "session", sessionId }, id: top.id },
                ];
              });
            }}
            session={session}
            sessions={sessionsOf(demo, session.hostId)}
          />
        );
      }
      case "changes":
        return (
          <ChangesScreen
            backLabel={backLabel}
            onBack={pop}
            repo={repoScope(frame.worktree)}
            scope={frame.worktree}
          />
        );
      case "files": {
        const session = demo.sessions.find(
          (item) => item.id === frame.sessionId
        );
        const worktree = session?.worktree ?? "";
        return (
          <FilesScreen
            backLabel={backLabel}
            onBack={pop}
            repo={repoScope(worktree)}
            scope={worktree}
          />
        );
      }
      default:
        return (
          <HostsScreen
            hosts={demo.hosts}
            onAdd={() => {
              push({ kind: "pair" });
            }}
            onEnter={(host) => {
              push({ hostId: host.id, kind: "workbench" });
            }}
            onRemove={(hostId) => {
              dispatch({ hostId, type: "host.remove" });
            }}
          />
        );
    }
  };

  return <NavStack entries={stack} render={render} />;
}
