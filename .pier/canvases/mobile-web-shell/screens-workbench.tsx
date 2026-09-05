import { type ReactNode, useEffect, useState } from "react";
import {
  type ConnState,
  connLabel,
  cx,
  IconButton,
  NavBar,
  PhoneShell,
  QuietEmpty,
  StatusDot,
  TOUCH_PRESS,
} from "./chrome.tsx";
import { Icon } from "./icons.tsx";
import type { DemoHost, DemoSession } from "./model.ts";
import { changesSummary, repoScope } from "./repo.ts";
import { SessionGlyph } from "./session-glyph.tsx";
import { TerminalPreview } from "./terminal-preview.tsx";

const CONNECT_MS = 800;
const STATUS_LABEL = {
  waiting: "需要你处理",
  processing: "运行中",
  ready: "就绪",
} as const;

/** 会话集合是终端预览网格；预览外只保留身份与状态。 */
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
    if (connection !== "connecting") return;
    const timer = setTimeout(() => setConnection("online"), CONNECT_MS);
    return () => clearTimeout(timer);
  }, [connection]);
  const waiting = props.sessions.filter(
    (session) => session.status === "waiting"
  ).length;
  const worktrees = [
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
          backIconOnly
          layout="split"
          title={props.host.name}
          subtitle={
            <>
              <StatusDot tone={connection === "online" ? "online" : "busy"} />
              <span>
                {props.host.reach === "relay" ? "远程 · " : ""}
                {connLabel(connection)}
                {props.host.reach === "lan" && connection === "online"
                  ? " · 局域网"
                  : ""}
              </span>
            </>
          }
          trailing={
            <IconButton
              className="rounded-full bg-surface-raised"
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
          title="这台电脑现在没有会话"
          body="请在电脑上开一个终端或智能体，这里会自动出现。"
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-7 overflow-y-auto overscroll-contain px-4 pt-5 pb-8 [scrollbar-width:thin]">
          <section aria-label="会话" className="flex flex-col gap-4">
            <div className="flex items-baseline justify-between gap-3 px-0.5">
              <h2 className="flex items-center gap-2 font-semibold text-[20px] leading-7 tracking-[-0.02em]">
                会话{" "}
                <span className="flex size-5 items-center justify-center rounded-md bg-surface-raised font-medium text-[11px] text-muted-foreground tabular-nums tracking-normal">
                  {props.sessions.length}
                </span>
              </h2>
              {waiting > 0 ? (
                <span className="shrink-0 text-[12px] text-status-warning-fg leading-5">
                  {waiting} 个需要你处理
                </span>
              ) : null}
            </div>
            <div
              className="grid grid-cols-2 items-start gap-x-3 gap-y-6"
              data-slot="terminal-grid"
            >
              {props.sessions.map((session) => (
                <button
                  aria-label={`${session.title}，${session.agent ?? "终端"}，${STATUS_LABEL[session.status]}，打开会话`}
                  className={cx(
                    "group min-w-0 rounded-xl text-left",
                    TOUCH_PRESS
                  )}
                  key={session.id}
                  onClick={() => props.onOpenSession?.(session.id)}
                  type="button"
                >
                  <TerminalPreview session={session} />
                  <span className="mt-2.5 block px-0.5">
                    <span className="block truncate font-semibold text-[16px] leading-[22px] tracking-[-0.015em]">
                      {session.title}
                    </span>
                    <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground leading-[18px]">
                      <SessionGlyph session={session} />
                      <span className="truncate">
                        {session.agent ?? "终端"}
                      </span>
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>
          {worktrees.length === 0 ? null : (
            <section aria-label="工作树变更" className="flex flex-col gap-2">
              <h2 className="px-0.5 font-medium text-[13px] text-muted-foreground leading-5">
                工作树变更
              </h2>
              <div className="divide-y divide-border/60 border-t border-border/60">
                {worktrees.map((worktree) => {
                  const repo = repoScope(worktree);
                  const summary = changesSummary(repo.changes);
                  return (
                    <button
                      className={cx(
                        "flex min-h-16 w-full items-center gap-3 py-3 text-left",
                        TOUCH_PRESS
                      )}
                      key={worktree}
                      onClick={() => props.onOpenChanges?.(worktree)}
                      type="button"
                    >
                      <Icon
                        className="size-[18px] shrink-0 text-muted-foreground"
                        name="branch"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-[14px] leading-5">
                          {worktree}
                        </span>
                        <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground leading-4">
                          {repo.branch}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-[11px] text-muted-foreground">
                          {summary.files} 个文件
                        </span>
                        <span className="mt-0.5 block font-mono text-[11px] tabular-nums">
                          <span className="text-status-success-fg">
                            +{summary.added}
                          </span>{" "}
                          <span className="text-status-danger-fg">
                            −{summary.removed}
                          </span>
                        </span>
                      </span>
                      <Icon
                        className="size-3.5 shrink-0 text-muted-foreground"
                        name="chevron-right"
                      />
                    </button>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}
    </PhoneShell>
  );
}
