/**
 * TerminalScreen（T1）：前台轮询 terminal.screen 渲染纯文本 + 「当前屏幕」标注。
 * T1 文案红线：不出现 scrollback / 完整历史 字样。
 */

import { LOCAL_CONTROL_API_VERSION } from "@shared/contracts/local-control/errors.ts";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TerminalScreen } from "../../../apps/mobile-web/src/components/terminal-screen.tsx";
import { PierMobileClient } from "../../../apps/mobile-web/src/lib/client.ts";

type MockListener = (event?: { data?: unknown }) => void;

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  /** 读屏响应延迟（模拟会合跨网慢链路）；0 = 即时回包。 */
  static screenDelayMs = 0;

  readonly sent: string[] = [];
  private readonly listeners = new Map<string, Set<MockListener>>();

  constructor() {
    MockWebSocket.instances.push(this);
  }

  emitOpen(): void {
    this.emit("open");
  }

  send(data: string): void {
    this.sent.push(data);
    const frame = JSON.parse(data) as Record<string, unknown>;
    if (frame.type === "client.hello") {
      this.emitMessage({
        apiVersion: LOCAL_CONTROL_API_VERSION,
        type: "server.hello",
        requestId: frame.requestId,
        bootId: "boot-1",
        serverTimeMs: 1,
        features: ["control.watch"],
      });
      return;
    }
    if (frame.type === "command") {
      const command = frame.command as Record<string, unknown> | undefined;
      if (command?.type === "terminal.screen") {
        const respond = () => {
          this.emitMessage({
            apiVersion: LOCAL_CONTROL_API_VERSION,
            type: "response",
            requestId: frame.requestId,
            ok: true,
            data: {
              capturedAt: 1,
              cols: 80,
              maxBytes: 65_536,
              maxLines: 200,
              panelId: command.panelId,
              rows: 24,
              scope: "viewport",
              text: "hello pier\ntask done",
              truncated: false,
              // 面板寻址：命令不带窗口，宿主解析后在响应里回填。
              windowId: "1",
            },
          });
        };
        if (MockWebSocket.screenDelayMs > 0) {
          setTimeout(respond, MockWebSocket.screenDelayMs);
        } else {
          respond();
        }
      }
    }
  }

  close(): void {
    this.emit("close");
  }

  addEventListener(type: string, listener: MockListener): void {
    const set = this.listeners.get(type) ?? new Set<MockListener>();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: MockListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  private emit(type: string, event?: { data?: unknown }): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  private emitMessage(frame: unknown): void {
    this.emit("message", { data: JSON.stringify(frame) });
  }
}

let lastSocket: MockWebSocket | null = null;
let activeClient: PierMobileClient | null = null;

async function connectClient(): Promise<PierMobileClient> {
  const client = new PierMobileClient({
    createWebSocket: () => {
      lastSocket = new MockWebSocket();
      return lastSocket;
    },
  });
  const handshake = client.connect({
    deviceId: "dev-1",
    deviceToken: "tok-1",
    host: "192.168.1.10",
    port: 4455,
  });
  lastSocket?.emitOpen();
  await handshake;
  activeClient = client;
  return client;
}

describe("TerminalScreen（T1 终端投影）", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    activeClient?.close();
    activeClient = null;
    MockWebSocket.instances = [];
    MockWebSocket.screenDelayMs = 0;
  });

  it("渲染 terminal.screen 纯文本并带「当前屏幕」标注", async () => {
    const client = await connectClient();
    render(<TerminalScreen client={client} panelId="panel-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("terminal-screen").textContent).toContain(
        "hello pier"
      );
    });
    expect(screen.getByTestId("terminal-screen").textContent).toContain(
      "当前屏幕"
    );
    expect(screen.getByTestId("terminal-screen").textContent).toContain(
      "页面可见时自动刷新"
    );
  });

  it("文案不出现「切回才刷新」（与 visibility 行为一致的语义）", async () => {
    const client = await connectClient();
    render(<TerminalScreen client={client} panelId="panel-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("terminal-screen").textContent).toContain(
        "hello pier"
      );
    });
    expect(document.body.textContent ?? "").not.toContain("切回才刷新");
  });

  it("页面隐藏 → 暂停轮询；恢复可见 → 立即拉一次并按 400ms 续跑", async () => {
    vi.useFakeTimers();
    const client = await connectClient();
    render(<TerminalScreen client={client} panelId="panel-1" />);
    const screenCommands = () =>
      (lastSocket?.sent ?? []).filter((data) => {
        const frame = JSON.parse(data) as {
          command?: { type?: string } | undefined;
        };
        return frame.command?.type === "terminal.screen";
      }).length;
    // 逐轮推进假时钟：既刷新微任务链（响应 promise 链），又不越过 400ms 轮询间隔。
    const drain = async () => {
      for (let i = 0; i < 4; i += 1) {
        await vi.advanceTimersByTimeAsync(1);
      }
    };

    // 初始 tick（页面可见）
    await drain();
    expect(screenCommands()).toBe(1);
    expect(screen.getByTestId("terminal-screen").textContent).toContain(
      "hello pier"
    );

    // 隐藏 → 暂停：1.2s 内无新请求
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(1200);
    expect(screenCommands()).toBe(1);

    // 恢复可见 → 立即拉一次
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await drain();
    expect(screenCommands()).toBe(2);

    // 续跑 400ms 轮询
    await vi.advanceTimersByTimeAsync(400);
    expect(screenCommands()).toBe(3);
    await vi.advanceTimersByTimeAsync(400);
    expect(screenCommands()).toBe(4);
  });

  it("慢链路（响应慢于轮询间隔）仍能首帧：顺序轮询不作废迟到响应", async () => {
    vi.useFakeTimers();
    // 会合跨网往返 600ms > 400ms 轮询间隔（M1 并发轮询在此场景永远无首帧）。
    MockWebSocket.screenDelayMs = 600;
    const client = await connectClient();
    render(<TerminalScreen client={client} panelId="panel-1" />);
    const screenCommands = () =>
      (lastSocket?.sent ?? []).filter((data) => {
        const frame = JSON.parse(data) as {
          command?: { type?: string } | undefined;
        };
        return frame.command?.type === "terminal.screen";
      }).length;

    // 首发已出；响应未到期间不得并发第二发。
    await vi.advanceTimersByTimeAsync(1);
    expect(screenCommands()).toBe(1);
    await vi.advanceTimersByTimeAsync(590);
    expect(screenCommands()).toBe(1);
    expect(screen.getByTestId("terminal-screen").textContent).toContain(
      "等待画面"
    );

    // 600ms 响应落地 → 首帧渲染；再过 400ms 才发下一发。
    await vi.advanceTimersByTimeAsync(20);
    for (let i = 0; i < 4; i += 1) {
      await vi.advanceTimersByTimeAsync(1);
    }
    expect(screen.getByTestId("terminal-screen").textContent).toContain(
      "hello pier"
    );
    await vi.advanceTimersByTimeAsync(400);
    expect(screenCommands()).toBe(2);
  });

  it("首帧后连接中断 → 保留画面并标注可能过期", async () => {
    const client = await connectClient();
    render(<TerminalScreen client={client} panelId="panel-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("terminal-screen").textContent).toContain(
        "hello pier"
      );
    });
    client.close();
    await waitFor(() => {
      expect(screen.getByTestId("terminal-screen-stale").textContent).toContain(
        "画面可能不是最新"
      );
    });
    // 冻结旧画面而非清空：用户仍可读最后状态。
    expect(screen.getByTestId("terminal-screen").textContent).toContain(
      "hello pier"
    );
  });

  it("字号可调并持久化到 localStorage", async () => {
    window.localStorage.removeItem("pier.mobile.terminal-font");
    const client = await connectClient();
    render(<TerminalScreen client={client} panelId="panel-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("terminal-screen").textContent).toContain(
        "hello pier"
      );
    });
    const pre = () =>
      screen.getByTestId("terminal-screen").querySelector("pre");
    expect(pre()?.className).toContain("text-[11px]");
    fireEvent.click(screen.getByTestId("terminal-font-inc"));
    expect(pre()?.className).toContain("text-[13px]");
    expect(window.localStorage.getItem("pier.mobile.terminal-font")).toBe("2");
    fireEvent.click(screen.getByTestId("terminal-font-dec"));
    fireEvent.click(screen.getByTestId("terminal-font-dec"));
    expect(pre()?.className).toContain("text-[10px]");
    window.localStorage.removeItem("pier.mobile.terminal-font");
  });

  it("T1 文案不含 scrollback / 完整历史 字样", async () => {
    const client = await connectClient();
    render(<TerminalScreen client={client} panelId="panel-1" />);
    await waitFor(() => {
      expect(screen.getByTestId("terminal-screen").textContent).toContain(
        "hello pier"
      );
    });
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/scrollback/i);
    expect(text).not.toContain("完整历史");
  });
});
