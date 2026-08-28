/**
 * S1 终端投影（T1）：页面可见时 400ms 轮询 terminal.screen，只渲染当前屏幕纯文本。
 * 有界 viewport 读屏——不含滚回与历史内容，T1 文案不得出现 scrollback/完整历史。
 */
import {
  type TerminalScreenPayload,
  terminalScreenPayloadSchema,
} from "@shared/contracts/terminal/screen.ts";
import { useEffect, useRef, useState } from "react";
import type { PierMobileClient } from "../lib/client.ts";

export const TERMINAL_POLL_INTERVAL_MS = 400;

export function TerminalScreen(props: {
  client: PierMobileClient;
  panelId: string;
  windowId: string;
  intervalMs?: number;
}) {
  const [screen, setScreen] = useState<TerminalScreenPayload | null>(null);
  const [failed, setFailed] = useState(false);
  // 只保留最后一次轮询结果：轮询是无状态读屏，竞态旧响应直接丢弃
  const seq = useRef(0);

  useEffect(() => {
    const intervalMs = props.intervalMs ?? TERMINAL_POLL_INTERVAL_MS;
    let alive = true;
    let timer: number | null = null;
    const tick = async () => {
      const mySeq = seq.current + 1;
      seq.current = mySeq;
      try {
        const payload = terminalScreenPayloadSchema.parse(
          await props.client.command<unknown>({
            panelId: props.panelId,
            type: "terminal.screen",
            windowId: props.windowId,
          })
        );
        if (alive && seq.current === mySeq) {
          setScreen(payload);
          setFailed(false);
        }
      } catch {
        if (alive && seq.current === mySeq) {
          setFailed(true);
        }
      }
    };
    // 页面可见时轮询，隐藏即暂停；恢复可见时立即拉一次再续跑。
    const startPolling = () => {
      if (timer !== null || document.visibilityState !== "visible") {
        return;
      }
      tick().catch(() => undefined);
      timer = window.setInterval(() => {
        tick().catch(() => undefined);
      }, intervalMs);
    };
    const stopPolling = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibilityChange = () => {
      stopPolling();
      if (document.visibilityState === "visible") {
        startPolling();
      }
    };
    startPolling();
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
      <p className="mb-1 flex items-center justify-between text-[10px] text-neutral-500">
        <span className="text-neutral-400">当前屏幕</span>
        <span>纯文本 · 页面可见时自动刷新</span>
      </p>
      {screen === null ? (
        <p className="text-neutral-500 text-xs">
          {failed ? "读屏暂不可用，正在重试…" : "等待画面…"}
        </p>
      ) : (
        <pre className="flex-1 overflow-hidden whitespace-pre-wrap font-mono text-[11px] text-neutral-100 leading-4">
          {screen.text.length > 0 ? screen.text : "（空屏幕）"}
        </pre>
      )}
    </section>
  );
}
