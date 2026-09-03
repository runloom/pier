import { type ReactNode, useEffect, useState } from "react";
import {
  type ConnState,
  connLabel,
  InstrumentChip,
  IconButton,
  NavBar,
  PhoneShell,
  QuietEmpty,
  SessionSlice,
  StatusDot,
} from "./chrome.tsx";
import type { DemoHost, DemoSession } from "./model.ts";
import { changesSummary, repoScope } from "./repo.ts";

const CONNECT_MS = 800;

/**
 * H2 这台电脑的工作台。活着的会话是当前屏幕切片（等待贴金条置顶），
 * 普通终端和变更收成顶栏下的仪器带。没有分组标题、没有新建。
 */
export function HostScreen(props: {
  connectOnMount?: boolean | undefined;
  host: DemoHost;
  onBack?: (() => void) | undefined;
  onOpenChanges?: ((worktree: string) => void) | undefined;
  onOpenInbox?: (() => void) | undefined;
  onOpenSession?: ((sessionId: string) => void) | undefined;
  sessions: readonly DemoSession[];
  unread: number;
}): ReactNode {
  const [connection, setConnection] = useState<ConnState>(
    props.connectOnMount === true ? "connecting" : "online"
  );

  useEffect(() => {
    if (connection !== "connecting") {
      return;
    }
    const timer = setTimeout(() => {
      setConnection("online");
    }, CONNECT_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [connection]);

  const live = props.sessions.filter(
    (session) =>
      session.status === "waiting" || session.status === "processing"
  );
  const rest = props.sessions.filter(
    (session) => session.status !== "waiting" && session.status !== "processing"
  );
  const gitWorktrees = [
    ...new Set(
      props.sessions
        .filter((session) => session.hasGit)
        .map((session) => session.worktree)
    ),
  ].filter((worktree) => changesSummary(repoScope(worktree).changes).files > 0);

  return (
    <PhoneShell
      nav={
        <NavBar
          back={{ label: "主机", onClick: props.onBack }}
          layout="split"
          subtitle={
            <>
              <StatusDot
                pulse={connection === "connecting"}
                tone={
                  connection === "online"
                    ? "online"
                    : connection === "connecting"
                      ? "busy"
                      : "offline"
                }
              />
              <span>
                {props.host.reach === "relay" ? "远程 · " : ""}
                {connLabel(connection)}
                {connection === "connecting" ? "…" : ""}
              </span>
            </>
          }
          title={props.host.name}
          trailing={
            <IconButton
              dot={props.unread > 0}
              icon="bell"
              label={props.unread > 0 ? `通知，${props.unread} 条未读` : "通知"}
              onClick={props.onOpenInbox}
            />
          }
        />
      }
    >
      {props.sessions.length === 0 ? (
        <QuietEmpty
          body="请在电脑上开一个终端或智能体，这里会自动出现。"
          title="这台电脑现在没有会话"
        />
      ) : (
        <>
          {rest.length === 0 && gitWorktrees.length === 0 ? null : (
            <div className="flex gap-1 overflow-x-auto px-2 [scrollbar-width:none]">
              {rest.map((session) => (
                <InstrumentChip
                  icon={session.kind === "agent" ? "sparkle" : "terminal"}
                  key={session.id}
                  label={session.title}
                  onClick={() => {
                    props.onOpenSession?.(session.id);
                  }}
                />
              ))}
              {gitWorktrees.map((worktree) => {
                const scope = repoScope(worktree);
                const summary = changesSummary(scope.changes);
                return (
                  <InstrumentChip
                    hint={
                      <>
                        <span className="text-status-success-fg">
                          +{summary.added}
                        </span>{" "}
                        <span className="text-status-danger-fg">
                          −{summary.removed}
                        </span>
                      </>
                    }
                    icon="branch"
                    key={worktree}
                    label={scope.branch}
                    onClick={() => {
                      props.onOpenChanges?.(worktree);
                    }}
                  />
                );
              })}
            </div>
          )}
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pb-8 [scrollbar-width:none]">
            {live.map((session) => (
              <SessionSlice
                key={session.id}
                maxLines={session.status === "waiting" ? 6 : 7}
                onOpen={() => {
                  props.onOpenSession?.(session.id);
                }}
                session={session}
              />
            ))}
          </div>
        </>
      )}
    </PhoneShell>
  );
}
