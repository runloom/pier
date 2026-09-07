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
  HitButton,
  NavAction,
  NavBar,
  PhoneShell,
  QuietEmpty,
  sessionSubtitle,
  TERMINAL_FONT_STEPS,
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

/** 阅读字号跟随设备记忆，量产行为与现行 localStorage 实现一致。 */
const FONT_PREF_KEY = "pier.mobile-web.reading-font";

function readFontPref(): number {
  const raw = globalThis.localStorage?.getItem(FONT_PREF_KEY);
  const parsed = raw === null || raw === undefined ? Number.NaN : Number(raw);
  return Number.isInteger(parsed) &&
    parsed >= 0 &&
    parsed < TERMINAL_FONT_STEPS.length
    ? parsed
    : DEFAULT_TERMINAL_FONT;
}

/** 读屏为主体，工具仅占一行。按键是受限输入能力，不是终端选项模型。 */
export function SessionScreen(props: {
  backLabel: string;
  disconnected?: boolean | undefined;
  /** T1 轮询滞后但连接未断：读屏顶缘给「画面可能不是最新」的新鲜度提示。 */
  feedInterrupted?: boolean | undefined;
  initialKeysOpen?: boolean | undefined;
  /** 与 initialKeysOpen 搭配：静态帧定格「已发送，等待终端响应」。 */
  initialEchoKey?: DemoResponseKey | undefined;
  initialSheet?: SessionSheet | undefined;
  /** 静态帧直接定格「回应已失效」态（P0 里要靠真实发送触发）。 */
  initialStale?: boolean | undefined;
  onBack?: (() => void) | undefined;
  onOpenChanges?: (() => void) | undefined;
  onOpenFiles?: (() => void) | undefined;
  onRespond?:
    | ((key: DemoResponseKey, interactionId: string) => DemoKeyResult)
    | undefined;
  /** 断线横幅上的手动重试；不传则不显示（保持纯被动等待）。 */
  onRetry?: (() => void) | undefined;
  onSwitchSession?: ((sessionId: string) => void) | undefined;
  session: DemoSession;
  sessions?: readonly DemoSession[] | undefined;
}): ReactNode {
  const [fontIndex, setFontIndexState] = useState(readFontPref);
  const setFontIndex = (index: number) => {
    setFontIndexState(index);
    globalThis.localStorage?.setItem(FONT_PREF_KEY, String(index));
  };
  const [sheet, setSheet] = useState<SessionSheet | null>(
    props.initialSheet ?? null
  );
  const [autoFocusSheet, setAutoFocusSheet] = useState(
    props.initialSheet === undefined
  );
  const [keysFor, setKeysFor] = useState<string | null>(
    props.initialKeysOpen === true ? props.session.id : null
  );
  const [staleFor, setStaleFor] = useState<string | null>(
    props.initialStale === true
      ? `${props.session.id}:${props.session.pendingInteractionId}`
      : null
  );
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
  const panelEligible =
    waiting &&
    interactionId !== undefined &&
    props.disconnected !== true &&
    props.onRespond !== undefined;
  const canSend = panelEligible && !stale;
  const keysOpen = keysFor === session.id && panelEligible;
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
              initialEcho={props.initialEchoKey}
              initialStale={props.initialStale === true}
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
            <div className="flex min-h-12 items-center gap-3 rounded-[20px] border border-border/80 bg-surface-raised py-1.5 pr-1.5 pl-4 shadow-xs">
              <span
                aria-hidden="true"
                className="size-1.5 shrink-0 rounded-full bg-warning"
              />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-[13px] leading-5">
                  需要你处理
                </p>
                {canSend ? null : (
                  <p
                    className="mt-0.5 text-[12px] text-muted-foreground leading-[18px]"
                    role="status"
                  >
                    {stale
                      ? "这次回应已失效。等智能体给出新的提示，这里会重新开放按键。"
                      : "此处暂不能回应，请在电脑上处理。"}
                  </p>
                )}
              </div>
              {canSend ? (
                <button
                  aria-expanded={keysOpen}
                  aria-label="打开终端按键，对照上面的提示发送"
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
                  className="mr-2 size-[18px] shrink-0 text-muted-foreground"
                  name="lock"
                />
              )}
            </div>
          ) : null}
          <div
            className={cx(
              "flex items-center justify-between gap-2",
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
          layout="split"
          onTitleClick={canSwitch ? () => setSheet("sessions") : undefined}
          subtitle={
            <span className="flex min-w-0 items-center gap-1.5">
              <SessionGlyph session={session} size={12} />
              <span className="truncate">{sessionSubtitle(session)}</span>
            </span>
          }
          title={session.title}
          titleOpen={sheet === "sessions"}
          trailing={
            <div className="flex items-center">
              {session.hasGit ? (
                <NavAction onClick={props.onOpenChanges}>变更</NavAction>
              ) : null}
              <NavAction onClick={props.onOpenFiles}>文件</NavAction>
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
          className="flex items-center gap-3 border-b border-status-warning-border bg-status-warning-bg px-4 py-3 text-[13px] text-status-warning-fg leading-5"
          role="status"
        >
          <div className="min-w-0 flex-1">
            <p className="font-medium">连接已断开</p>
            <p className="mt-0.5">正在等待恢复，以下是断开前的内容。</p>
          </div>
          {props.onRetry === undefined ? null : (
            <button
              className="flex min-h-11 shrink-0 items-center rounded-full border border-status-warning-border px-4 font-medium transition-colors duration-75 active:bg-interactive-active"
              onClick={props.onRetry}
              type="button"
            >
              重试
            </button>
          )}
        </div>
      ) : props.feedInterrupted === true ? (
        <div
          className="border-b border-border/50 px-4 py-2 text-[12px] text-status-warning-fg leading-5"
          role="status"
        >
          读取中断 · 画面可能不是最新，恢复后自动更新。
        </div>
      ) : null}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <TerminalSurface
          className="px-4 pt-4 pb-6"
          fontIndex={fontIndex}
          key={session.id}
          lines={session.screen}
          ref={terminalRef}
        />
        {keysOpen ? null : (
          <span className="pointer-events-none absolute top-2 right-3 rounded-full border border-border/60 bg-surface-raised px-2 py-0.5 text-[11px] text-muted-foreground leading-4">
            {canSend ? "当前屏幕" : "当前屏幕 · 只读"}
          </span>
        )}
      </div>
    </PhoneShell>
  );
}

/** S1x：通知指向的会话已在电脑上结束。不落空帧，给明确终态与去向。 */
export function SessionEndedScreen(props: {
  backLabel: string;
  onBack?: (() => void) | undefined;
  /** 终态页的去向：回到这台电脑的工作台。 */
  onOpenWorkbench?: (() => void) | undefined;
  title?: string | undefined;
}): ReactNode {
  return (
    <PhoneShell
      nav={
        <NavBar
          back={{ label: props.backLabel, onClick: props.onBack }}
          layout="split"
          title={props.title ?? "会话"}
        />
      }
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <QuietEmpty
          body="它在电脑上已关闭；相关通知已标为已读。可以在工作台上查看还在运行的会话。"
          title="该会话已结束"
        />
        {props.onOpenWorkbench === undefined ? null : (
          <div className="px-6 pb-10">
            <HitButton
              className="w-full"
              onClick={props.onOpenWorkbench}
              variant="outline"
            >
              查看工作台
            </HitButton>
          </div>
        )}
      </div>
    </PhoneShell>
  );
}
