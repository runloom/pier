import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  cx,
  DEFAULT_TERMINAL_FONT,
  IconButton,
  NavBar,
  PhoneShell,
  TerminalSurface,
  TOUCH_PRESS,
} from "./chrome.tsx";
import { Icon } from "./icons.tsx";
import type { DemoKeyResult, DemoResponseKey, DemoSession } from "./model.ts";
import { SessionGlyph } from "./session-glyph.tsx";
import { ReadingSheet, SessionSwitcher } from "./sheets.tsx";
import { TerminalKeys } from "./terminal-keys.tsx";

export type SessionSheet = "sessions" | "reading";

const TOOL_BUTTON =
  "flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-full px-3.5 text-[13px] font-medium leading-5";

/** 读屏为主体，工具仅占一行。按键是受限输入能力，不是终端选项模型。 */
export function SessionScreen(props: {
  backLabel: string;
  dirty?: boolean | undefined;
  initialSheet?: SessionSheet | undefined;
  initialKeysOpen?: boolean | undefined;
  disconnected?: boolean | undefined;
  onBack?: (() => void) | undefined;
  onOpenChanges?: (() => void) | undefined;
  onOpenFiles?: (() => void) | undefined;
  onRespond?:
    | ((key: DemoResponseKey, interactionId: string) => DemoKeyResult)
    | undefined;
  onSwitchSession?: ((sessionId: string) => void) | undefined;
  session: DemoSession;
  sessions?: readonly DemoSession[] | undefined;
}): ReactNode {
  const [fontIndex, setFontIndex] = useState(DEFAULT_TERMINAL_FONT);
  const [sheet, setSheet] = useState<SessionSheet | null>(
    props.initialSheet ?? null
  );
  const [autoFocusSheet, setAutoFocusSheet] = useState(
    props.initialSheet === undefined
  );
  const [keysFor, setKeysFor] = useState<string | null>(
    props.initialKeysOpen === true ? props.session.id : null
  );
  const [staleFor, setStaleFor] = useState<string | null>(null);
  const terminalRef = useRef<HTMLPreElement>(null);
  const restoreKeyFocus = useRef(false);
  const keyToggleRef = useCallback((node: HTMLButtonElement | null) => {
    if (node !== null && restoreKeyFocus.current) {
      node.focus();
      restoreKeyFocus.current = false;
    }
  }, []);
  const session = props.session;
  const waiting = session.kind === "agent" && session.status === "waiting";
  const interactionId = session.pendingInteractionId;
  const inputKey = `${session.id}:${interactionId}`;
  const stale = staleFor === inputKey;
  const canSend =
    waiting &&
    interactionId !== undefined &&
    !stale &&
    props.disconnected !== true &&
    props.onRespond !== undefined;
  const keysOpen = keysFor === session.id && canSend;
  const peers = props.sessions ?? [session];
  const canSwitch = peers.length > 1 && props.onSwitchSession !== undefined;
  const closeSheet = () => {
    setAutoFocusSheet(true);
    setSheet(null);
  };
  const revealPrompt = useCallback(() => {
    if (terminalRef.current !== null)
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
  }, []);
  useEffect(() => {
    if (keysOpen) revealPrompt();
  }, [fontIndex, keysOpen, revealPrompt]);
  return (
    <PhoneShell
      footer={
        <div className="border-t border-border/50 px-3 pt-3 pb-3">
          {keysOpen ? (
            <TerminalKeys
              key={inputKey}
              onClose={() => {
                restoreKeyFocus.current = true;
                setKeysFor(null);
              }}
              onLayoutChange={revealPrompt}
              onSend={(key) => {
                const result = props.onRespond?.(key, interactionId) ?? "stale";
                if (result === "stale") setStaleFor(inputKey);
                return result;
              }}
            />
          ) : waiting && props.disconnected !== true ? (
            <div className="flex min-h-[72px] items-center gap-3 rounded-[20px] border border-border/80 bg-surface-raised py-2 pr-2 pl-4 shadow-xs">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-semibold text-[13px] leading-5">
                  <span
                    aria-hidden="true"
                    className="size-1.5 shrink-0 rounded-full bg-warning"
                  />
                  需要你处理
                </p>
                <p
                  className="mt-0.5 text-[12px] text-muted-foreground leading-[18px]"
                  role={canSend ? undefined : "status"}
                >
                  {canSend
                    ? "按终端提示回应"
                    : stale
                      ? "这次回应已失效，请重新查看终端。"
                      : "此处暂不能回应，请在电脑上处理。"}
                </p>
              </div>
              {canSend ? (
                <button
                  aria-expanded={false}
                  className={cx(
                    "flex min-h-11 shrink-0 items-center gap-2 rounded-full bg-action-accent px-4 font-medium text-[13px] text-action-accent-foreground",
                    TOUCH_PRESS,
                    "enabled:active:bg-action-accent! enabled:active:opacity-80"
                  )}
                  onClick={() => setKeysFor(session.id)}
                  ref={keyToggleRef}
                  type="button"
                >
                  <Icon className="size-[18px]" name="keyboard" />
                  按键
                </button>
              ) : (
                <Icon
                  className="mr-3 size-[18px] shrink-0 text-muted-foreground"
                  name="lock"
                />
              )}
            </div>
          ) : null}
          <div
            className={cx(
              "grid grid-cols-[1fr_auto_1fr] items-center gap-2",
              waiting && props.disconnected !== true && "mt-2"
            )}
            role="group"
            aria-label="终端阅读工具"
          >
            <button
              aria-haspopup="dialog"
              className={cx(
                TOOL_BUTTON,
                TOUCH_PRESS,
                "justify-self-start text-muted-foreground"
              )}
              onClick={() => setSheet("reading")}
              type="button"
            >
              <span className="text-[18px] font-normal tracking-[-0.04em]">
                Aa
              </span>
              字号
            </button>
            <span className="text-[11px] text-muted-foreground">
              {canSend ? null : "只读"}
            </span>
            {canSwitch ? (
              <button
                aria-haspopup="dialog"
                className={cx(
                  TOOL_BUTTON,
                  TOUCH_PRESS,
                  "justify-self-end bg-surface-raised"
                )}
                onClick={() => setSheet("sessions")}
                type="button"
              >
                <Icon className="size-[18px] shrink-0" name="panels" />
                会话
                <span className="font-normal text-muted-foreground tabular-nums">
                  {peers.length}
                </span>
              </button>
            ) : (
              <span />
            )}
          </div>
        </div>
      }
      nav={
        <NavBar
          back={{ label: props.backLabel, onClick: props.onBack }}
          backIconOnly
          layout="split"
          onTitleClick={canSwitch ? () => setSheet("sessions") : undefined}
          subtitle={
            <span className="flex min-w-0 items-center gap-1.5">
              <SessionGlyph session={session} size={12} />
              <span className="truncate">
                {session.agent ?? "终端"} ·{" "}
                {props.disconnected === true
                  ? "连接已断开"
                  : waiting
                    ? "需要你处理"
                    : session.status === "processing"
                      ? "运行中"
                      : "就绪"}
              </span>
            </span>
          }
          title={session.title}
          titleOpen={sheet === "sessions"}
          trailing={
            <div className="flex rounded-full bg-surface-raised">
              {session.hasGit ? (
                <IconButton
                  icon="branch"
                  label={props.dirty === true ? "变更，有未提交的改动" : "变更"}
                  onClick={props.onOpenChanges}
                />
              ) : null}
              <IconButton
                icon="folder"
                label="文件"
                onClick={props.onOpenFiles}
              />
            </div>
          }
        />
      }
      overlay={
        sheet === "sessions" ? (
          <SessionSwitcher
            autoFocus={autoFocusSheet}
            currentId={session.id}
            onClose={closeSheet}
            onPick={(id) => {
              closeSheet();
              if (id !== session.id) {
                setKeysFor(null);
                props.onSwitchSession?.(id);
              }
            }}
            sessions={peers}
          />
        ) : sheet === "reading" ? (
          <ReadingSheet
            fontIndex={fontIndex}
            onChange={setFontIndex}
            onClose={closeSheet}
          />
        ) : undefined
      }
      tone="terminal"
    >
      {props.disconnected === true ? (
        <div
          className="border-b border-status-warning-border bg-status-warning-bg px-4 py-3 text-[13px] text-status-warning-fg leading-5"
          role="status"
        >
          <p className="font-medium">连接已断开</p>
          <p className="mt-0.5">正在等待恢复，以下是断开前的内容。</p>
        </div>
      ) : null}
      <TerminalSurface
        className="px-4 pt-4 pb-6"
        fontIndex={fontIndex}
        key={session.id}
        lines={session.screen}
        ref={terminalRef}
      />
    </PhoneShell>
  );
}
