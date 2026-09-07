import {
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cx, TOUCH_PRESS } from "./chrome.tsx";
import { Icon } from "./icons.tsx";
import {
  DEMO_RESPONSE_KEYS,
  type DemoKeyResult,
  type DemoResponseKey,
} from "./model.ts";

const DIGITS = DEMO_RESPONSE_KEYS.filter((key) => /^[1-9]$/.test(key));
const KEY_LABELS: Partial<Record<DemoResponseKey, string>> = {
  enter: "Enter",
  escape: "Esc",
};
const SEND_FEEDBACK_MS = 450;
/** 「已发送」到终端画面经下一轮轮询实际变化之间的空窗：锁住按键，防重复发送。 */
const ECHO_WAIT_MS = 1500;

/** 受限按键面板。13 个原始键，不解释终端选项，也不模拟命令完成。 */
export function TerminalKeys(props: {
  onSend: (key: DemoResponseKey) => DemoKeyResult;
  onLayoutChange: () => void;
  onClose: () => void;
  initialDigitsOpen?: boolean | undefined;
  /** 静态帧直接定格「已发送，等待终端响应」的回执锁键态。 */
  initialEcho?: DemoResponseKey | undefined;
  /** 静态帧 / 发送回 stale 时面板先停住，由用户收起。 */
  initialStale?: boolean | undefined;
}): ReactNode {
  const digitsId = useId();
  const [digitsOpen, setDigitsOpen] = useState(
    props.initialDigitsOpen === true
  );
  // 数字键展开后读屏区域变矮，提交布局后仍让最新提示可见。
  useLayoutEffect(
    () => props.onLayoutChange(),
    [digitsOpen, props.onLayoutChange]
  );
  const [pending, setPending] = useState<DemoResponseKey | null>(null);
  const [feedback, setFeedback] = useState<{
    key: DemoResponseKey;
    result: DemoKeyResult;
  } | null>(
    props.initialEcho === undefined
      ? null
      : { key: props.initialEcho, result: "accepted" }
  );
  const [echoWait, setEchoWait] = useState(props.initialEcho !== undefined);
  const [staleHold, setStaleHold] = useState(props.initialStale === true);
  const sendRef = useRef(props.onSend);
  sendRef.current = props.onSend;
  useEffect(() => {
    if (pending === null) return;
    const timer = setTimeout(() => {
      let result: DemoKeyResult;
      try {
        result = sendRef.current(pending);
      } catch {
        result = "failed";
      }
      setFeedback({ key: pending, result });
      setEchoWait(result === "accepted");
      if (result === "stale") setStaleHold(true);
      setPending(null);
    }, SEND_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [pending]);
  useEffect(() => {
    if (!echoWait) return;
    const timer = setTimeout(() => {
      // 等待窗口结束后保留「已发送」回执，用户回头看仍能确认刚才发出过什么。
      setEchoWait(false);
    }, ECHO_WAIT_MS);
    return () => clearTimeout(timer);
  }, [echoWait]);
  const blocked = pending !== null || echoWait || staleHold;
  const message =
    staleHold
      ? "这次回应已失效。收起后，等新的提示出现再发送。"
      : pending !== null
        ? `正在发送 ${KEY_LABELS[pending] ?? pending}…`
        : echoWait && feedback?.result === "accepted"
          ? `已发送 ${KEY_LABELS[feedback.key] ?? feedback.key}，等待终端响应…`
          : feedback?.result === "accepted"
            ? `已发送 ${KEY_LABELS[feedback.key] ?? feedback.key}。当前屏幕还没更新，请稍等，或到电脑上确认。`
            : feedback?.result === "failed"
              ? "未能发送，请重试"
              : "按终端提示发送按键";
  const keyButton = (key: DemoResponseKey) => (
    <button
      aria-label={`发送 ${KEY_LABELS[key] ?? key} 键`}
      aria-busy={pending === key}
      className={cx(
        "flex h-12 min-w-11 items-center justify-center gap-1.5 rounded-[10px] border border-border bg-secondary font-mono text-[16px] shadow-xs disabled:opacity-40 [.light_&]:bg-card",
        TOUCH_PRESS,
        pending === key &&
          "border-foreground/30 bg-secondary disabled:opacity-100"
      )}
      disabled={blocked}
      key={key}
      onClick={() => {
        setFeedback(null);
        setPending(key);
      }}
      type="button"
    >
      {KEY_LABELS[key] ?? key}
      {key === "enter" ? (
        <Icon className="size-3.5" name="corner-up-left" />
      ) : null}
    </button>
  );
  return (
    <section
      aria-label="终端按键"
      className="rounded-[20px] border border-border/80 bg-surface-raised px-3 pb-3 shadow-xs"
    >
      <div className="flex min-h-[52px] items-center gap-1">
        <span className="min-w-0 flex-1 pl-1 font-semibold text-[13px]">
          终端按键
        </span>
        <button
          aria-label={digitsOpen ? "收起数字键" : "数字键 1–9"}
          aria-controls={digitsOpen ? digitsId : undefined}
          aria-expanded={digitsOpen}
          className={cx(
            "flex min-h-11 items-center gap-1 rounded-full px-3 text-[12px]",
            TOUCH_PRESS,
            digitsOpen
              ? "bg-background text-foreground"
              : "text-muted-foreground"
          )}
          onClick={() => setDigitsOpen((open) => !open)}
          type="button"
        >
          <span className="font-mono text-[14px]">1–9</span>
        </button>
        <button
          aria-label="收起按键"
          className={cx(
            "-mr-1 flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground",
            TOUCH_PRESS
          )}
          onClick={props.onClose}
          type="button"
        >
          <Icon className="size-[18px]" name="chevron-down" />
        </button>
      </div>
      {digitsOpen ? (
        <div className="mb-3 border-border/60 border-b pb-3" id={digitsId}>
          <p className="mb-2 px-1 text-[12px] text-muted-foreground leading-4">
            数字键
          </p>
          <div className="grid grid-cols-3 gap-2">{DIGITS.map(keyButton)}</div>
        </div>
      ) : null}
      <div className="grid grid-cols-[1fr_1fr_1fr_1.2fr] gap-2">
        {(["escape", "y", "n", "enter"] as const).map(keyButton)}
      </div>
      <p
        className={cx(
          "mt-2 min-h-5 px-1 text-[12px] leading-5",
          staleHold || feedback?.result === "failed"
            ? "text-status-warning-fg"
            : "text-muted-foreground"
        )}
        role="status"
      >
        {message}
      </p>
    </section>
  );
}
