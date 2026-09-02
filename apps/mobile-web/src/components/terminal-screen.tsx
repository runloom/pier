/**
 * S1 终端投影（T1）：页面可见时顺序轮询 terminal.screen（上一发落地后
 * 间隔 400ms 再发下一发），只渲染当前屏幕纯文本。
 * 有界 viewport 读屏——不含滚回与历史内容，T1 文案不得出现 scrollback/完整历史。
 */
import {
  type TerminalScreenPayload,
  terminalScreenPayloadSchema,
} from "@shared/contracts/terminal/screen.ts";
import { useEffect, useState } from "react";
import type { PierMobileClient } from "../lib/client.ts";

export const TERMINAL_POLL_INTERVAL_MS = 400;

/** 读屏字号档位（等宽）；索引持久化 localStorage。 */
const FONT_CLASSES = [
  "text-[10px] leading-4",
  "text-[11px] leading-4",
  "text-[13px] leading-5",
] as const;
const FONT_STORAGE_KEY = "pier.mobile.terminal-font";
const DEFAULT_FONT_INDEX = 1;

function readFontIndex(): number {
  try {
    const raw = window.localStorage.getItem(FONT_STORAGE_KEY);
    const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed < FONT_CLASSES.length)
      return parsed;
  } catch {
    // localStorage 不可用（隐私模式等）：用默认档
  }
  return DEFAULT_FONT_INDEX;
}

export function TerminalScreen(props: {
  client: PierMobileClient;
  panelId: string;
  /** 跨窗消歧；缺省时宿主须恰好一命中，否则 fail-closed。 */
  windowId?: string;
  intervalMs?: number;
}) {
  const [screen, setScreen] = useState<TerminalScreenPayload | null>(null);
  const [failed, setFailed] = useState(false);
  const [fontIndex, setFontIndex] = useState(readFontIndex);

  const bumpFont = (delta: number) => {
    setFontIndex((current) => {
      const next = Math.min(
        FONT_CLASSES.length - 1,
        Math.max(0, current + delta)
      );
      try {
        window.localStorage.setItem(FONT_STORAGE_KEY, String(next));
      } catch {
        // 持久化失败不影响本次会话内的字号
      }
      return next;
    });
  };

  useEffect(() => {
    const intervalMs = props.intervalMs ?? TERMINAL_POLL_INTERVAL_MS;
    let alive = true;
    let timer: number | null = null;
    let inFlight = false;

    // 顺序轮询：上一发落地才排下一发。跨网会合的往返延迟可能超过轮询间隔，
    // 并发定时轮询会让每个响应恒被「更新的一发」作废（画面永远无法首帧），
    // 慢链路上还会无界堆积在途请求；顺序化天然消除乱序，无需序号竞态判定。
    const scheduleNext = () => {
      if (!alive || timer !== null || document.visibilityState !== "visible") {
        return;
      }
      timer = window.setTimeout(() => {
        timer = null;
        tick().catch(() => undefined);
      }, intervalMs);
    };
    async function tick(): Promise<void> {
      if (!alive || inFlight) {
        return;
      }
      inFlight = true;
      try {
        const payload = terminalScreenPayloadSchema.parse(
          await props.client.command<unknown>({
            panelId: props.panelId,
            type: "terminal.screen",
            ...(props.windowId === undefined
              ? {}
              : { windowId: props.windowId }),
          })
        );
        if (alive) {
          setScreen(payload);
          setFailed(false);
        }
      } catch {
        if (alive) {
          setFailed(true);
        }
      } finally {
        inFlight = false;
        scheduleNext();
      }
    }
    // 页面可见时轮询，隐藏即暂停；恢复可见时立即拉一次再续跑。
    const stopPolling = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };
    const onVisibilityChange = () => {
      stopPolling();
      if (document.visibilityState === "visible") {
        tick().catch(() => undefined);
      }
    };
    tick().catch(() => undefined);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      alive = false;
      stopPolling();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [props.client, props.panelId, props.windowId, props.intervalMs]);

  return (
    <section
      className="flex flex-1 flex-col bg-black px-3 py-2"
      data-testid="terminal-screen"
    >
      <p className="mb-1 flex items-center justify-between gap-2 text-[10px] text-neutral-500">
        <span className="text-neutral-400">当前屏幕</span>
        <span className="flex items-center gap-1">
          {failed && screen !== null ? (
            <span
              className="mr-1 text-amber-400"
              data-testid="terminal-screen-stale"
            >
              读取中断 · 画面可能不是最新
            </span>
          ) : (
            <span className="mr-1">纯文本 · 页面可见时自动刷新</span>
          )}
          <button
            className="min-h-8 min-w-8 rounded border border-neutral-700 text-[11px] text-neutral-300 active:bg-neutral-800"
            data-testid="terminal-font-dec"
            disabled={fontIndex === 0}
            onClick={() => bumpFont(-1)}
            type="button"
          >
            A−
          </button>
          <button
            className="min-h-8 min-w-8 rounded border border-neutral-700 text-[11px] text-neutral-300 active:bg-neutral-800"
            data-testid="terminal-font-inc"
            disabled={fontIndex === FONT_CLASSES.length - 1}
            onClick={() => bumpFont(1)}
            type="button"
          >
            A+
          </button>
        </span>
      </p>
      {screen === null ? (
        <p className="text-neutral-500 text-xs">
          {failed ? "读屏暂不可用，正在重试…" : "等待画面…"}
        </p>
      ) : (
        <pre
          className={`flex-1 overflow-hidden whitespace-pre-wrap font-mono text-neutral-100 ${FONT_CLASSES[fontIndex]}`}
        >
          {screen.text.length > 0 ? screen.text : "（空屏幕）"}
        </pre>
      )}
    </section>
  );
}
