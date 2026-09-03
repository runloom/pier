import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  cx,
  DEFAULT_TERMINAL_FONT,
  IconButton,
  KeyCap,
  NavBar,
  PhoneShell,
  sessionStatusBadge,
  sessionSubtitle,
  TERMINAL_FONT_STEPS,
  TerminalSurface,
} from "./chrome.tsx";
import { Icon } from "./icons.tsx";
import type { DemoSession } from "./model.ts";

/** 按键按下 → 显示「已发送」→ 回写；给人看见反馈再让键行退出发出态。 */
const SEND_FEEDBACK_MS = 900;

/**
 * S1 会话：当前屏幕铺满玻璃。顶栏只留返回、会话名、git、文件。
 * 标题下拉切同机其它会话（覆盖层，不推入）。未等待不挂键；
 * 需要你处理时把 1/2/3/Enter/Esc 叠在屏幕下缘。
 */
export function SessionScreen(props: {
  backLabel: string;
  dirty?: boolean | undefined;
  onBack?: (() => void) | undefined;
  onOpenChanges?: (() => void) | undefined;
  onOpenFiles?: (() => void) | undefined;
  onRespond?: ((key: string) => void) | undefined;
  onSwitchSession?: ((sessionId: string) => void) | undefined;
  session: DemoSession;
  sessions?: readonly DemoSession[] | undefined;
}): ReactNode {
  const [fontIndex, setFontIndex] = useState(DEFAULT_TERMINAL_FONT);
  const [switcher, setSwitcher] = useState(false);
  const session = props.session;
  const waiting = session.kind === "agent" && session.status === "waiting";
  const peers = props.sessions ?? [session];
  const canSwitch = peers.length > 1 && props.onSwitchSession !== undefined;
  const subtitle =
    session.kind === "agent" ? (session.agent ?? "智能体") : "终端";

  return (
    <PhoneShell
      footer={waiting ? <KeyDock onRespond={props.onRespond} /> : undefined}
      nav={
        <NavBar
          back={{ label: props.backLabel, onClick: props.onBack }}
          backIconOnly
          ghost
          layout="split"
          onTitleClick={
            canSwitch
              ? () => {
                  setSwitcher((open) => !open);
                }
              : undefined
          }
          subtitle={<span>{subtitle}</span>}
          title={session.title}
          titleOpen={switcher}
          trailing={
            <>
              {session.hasGit ? (
                <IconButton
                  icon="branch"
                  label={
                    props.dirty === true ? "变更，有未提交的改动" : "变更"
                  }
                  onClick={props.onOpenChanges}
                />
              ) : null}
              <IconButton
                icon="folder"
                label="文件"
                onClick={props.onOpenFiles}
              />
            </>
          }
        />
      }
      overlay={
        switcher ? (
          <SessionSwitcher
            currentId={session.id}
            onClose={() => {
              setSwitcher(false);
            }}
            onPick={(sessionId) => {
              setSwitcher(false);
              if (sessionId !== session.id) {
                props.onSwitchSession?.(sessionId);
              }
            }}
            sessions={peers}
          />
        ) : undefined
      }
      tone="terminal"
    >
      <TerminalSurface
        className="px-4 pt-[52px] pb-36"
        cursor={session.status === "ready"}
        fontIndex={fontIndex}
        lines={session.screen}
        onDoubleClick={() => {
          setFontIndex((value) => (value + 1) % TERMINAL_FONT_STEPS.length);
        }}
      />
    </PhoneShell>
  );
}

function SessionSwitcher(props: {
  currentId: string;
  onClose: () => void;
  onPick: (sessionId: string) => void;
  sessions: readonly DemoSession[];
}): ReactNode {
  return (
    <div className="absolute inset-0 z-20 flex flex-col pt-[52px]">
      <div
        className="mx-3 max-h-[58%] overflow-y-auto rounded-2xl border border-border bg-card/95 px-2 py-2 [scrollbar-width:none]"
        role="listbox"
      >
        <p className="px-3 pt-1 pb-2 text-[12px] text-muted-foreground leading-4">
          这台电脑上的会话
        </p>
        {props.sessions.map((session) => {
          const current = session.id === props.currentId;
          return (
            <button
              aria-selected={current}
              className={cx(
                "flex min-h-14 w-full items-center gap-3 rounded-xl px-3 text-left transition-colors duration-75 active:bg-interactive-active",
                current && "bg-secondary"
              )}
              key={session.id}
              onClick={() => {
                props.onPick(session.id);
              }}
              role="option"
              type="button"
            >
              <Icon
                className="size-5 shrink-0 text-muted-foreground"
                name={session.kind === "agent" ? "sparkle" : "terminal"}
              />
              <span className="min-w-0 flex-1 py-2">
                <span className="block truncate text-[15px] leading-5">
                  {session.title}
                </span>
                <span className="mt-0.5 block truncate text-[12px] text-muted-foreground leading-4">
                  {sessionSubtitle(session)}
                </span>
              </span>
              {sessionStatusBadge(session)}
            </button>
          );
        })}
      </div>
      <button
        aria-label="关闭会话列表"
        className="min-h-0 flex-1 bg-overlay-scrim"
        onClick={props.onClose}
        type="button"
      />
    </div>
  );
}

function KeyDock(props: {
  onRespond?: ((key: string) => void) | undefined;
}): ReactNode {
  const [sent, setSent] = useState<string | null>(null);
  const respondRef = useRef(props.onRespond);
  respondRef.current = props.onRespond;

  useEffect(() => {
    if (sent === null) {
      return;
    }
    const timer = setTimeout(() => {
      const respond = respondRef.current;
      if (respond === undefined) {
        setSent(null);
        return;
      }
      respond(sent);
    }, SEND_FEEDBACK_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [sent]);

  const send = (key: string) => {
    if (sent !== null) {
      return;
    }
    setSent(key);
  };
  const locked = sent !== null;

  return (
    <section aria-label="需要你处理" className="px-4 pb-8">
      {sent === null ? null : (
        <p
          className="flex min-h-5 items-center justify-center gap-1 pb-2 text-[12px] text-success leading-4"
          role="status"
        >
          <Icon className="size-3.5" name="check" strokeWidth={2.25} />
          已发送 {sent}
        </p>
      )}
      <div className="flex justify-center gap-1.5">
        {(["1", "2", "3"] as const).map((key) => (
          <KeyCap
            disabled={locked}
            key={key}
            onClick={() => {
              send(key);
            }}
          >
            {key}
          </KeyCap>
        ))}
        <KeyCap
          disabled={locked}
          label="Enter"
          onClick={() => {
            send("Enter");
          }}
          tone="accent"
          wide
        >
          Enter
        </KeyCap>
        <KeyCap
          disabled={locked}
          label="Escape"
          onClick={() => {
            send("Esc");
          }}
        >
          Esc
        </KeyCap>
      </div>
    </section>
  );
}
