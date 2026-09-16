import { chmodSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import {
  FX_HERDR_AGENT,
  FX_HERDR_SOURCE,
  fxHerdrPanelId,
  fxHerdrToAgentEvent,
  parseFxHerdrFrame,
} from "@shared/contracts/agent/fx-herdr.ts";
import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";
import { createLogger } from "@shared/logger.ts";

const log = createLogger("foreground-activity.fx-herdr");

/**
 * fx Herdr 状态监听：Pier 冒充 Herdr multiplexor，fx 经
 * HERDR_SOCKET_PATH 上报 lifecycle（idle/working/blocked）。
 *
 * 上游协议（vercel-labs/fx@e45d780933bfb42ae376aee54a49bd3ebe81f04d，
 * `src/builtins/hooks/herdr.zig` + `src/builtins/hooks.zig`）：
 * - 短连接 Unix socket，每 report 一次 connect；单行 JSON-RPC
 *   `pane.report_agent`（id 为字符串）；fx 等 ≤250ms 单行回包后关连接。
 * - 只在 interactive scope 上报；ask one-shot 无 Herdr 引用。
 * - 启动先 reportSession 再 idle+announce；prompt 入队 → working；
 *   PostTurnEnd → idle；AttentionRequired → blocked+reason
 *   （permission/question/route_recovery→recovery）；exit 经 release 清理。
 *
 * Pier 侧纪律：
 * - socket 路径按实例 userData 隔离（`fx-herdr.sock`），0600；只接受
 *   source=custom:fx 且 agent=fx 的帧，其余静默丢弃。
 * - HERDR_PANE_ID 即 Pier panelId（`terminal-*`）；跨窗口同名 panel 经
 *   owner 路由解决（与 JSONL observer 同入口）。
 * - working→processing、idle→ActivityIdle、blocked permission/question→
 *   InteractionRequested、blocked recovery→processing；turnId 恒为空
 *   （PromptSubmit 文件水位纪律）。
 * - 本监听只产生 hook 事件；转录对账不适用（session.json 快照式单文件，
 *   durableReplace 原子替换，无可 tail 的 JSONL 终态流）。
 */

export interface FxHerdrListener {
  dispose(): void;
  /** fx PTY 应注入的环境变量；未启动时返回空对象。 */
  env(): Record<string, string>;
  socketPath: string | null;
}

export interface FxHerdrListenerOwner {
  panelId: string;
  windowId: string;
}

export function fxHerdrSocketPath(userData: string): string {
  // 实例 userData 内：短路径天然 ≤103B，无需 tmpdir fallback。
  return join(userData, "fx-herdr.sock");
}

export function createFxHerdrListener(options: {
  onAgentEvent: (event: AgentHookEventPayload) => void;
  resolveOwner: (panelId: string) => FxHerdrListenerOwner | null;
  userData: string;
}): FxHerdrListener {
  const sockets = new Set<Socket>();
  let server: Server | null = null;
  let disposed = false;
  const socketPath = fxHerdrSocketPath(options.userData);

  function handleLine(line: string): void {
    const report = parseFxHerdrFrame(line);
    if (!report) {
      return;
    }
    const panelId = fxHerdrPanelId(report.paneId);
    if (!panelId) {
      return;
    }
    const owner = options.resolveOwner(panelId);
    if (!owner) {
      return;
    }
    try {
      options.onAgentEvent(fxHerdrToAgentEvent(report, owner));
    } catch (error) {
      log.warn("fx herdr ingest failed", {
        code:
          error && typeof error === "object" && "code" in error
            ? String(error.code)
            : "unknown",
      });
    }
  }

  function attachConnection(socket: Socket): void {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let index = buffer.indexOf("\n");
      while (index !== -1) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line) {
          handleLine(line);
        }
        index = buffer.indexOf("\n");
      }
      if (buffer.length > 64 * 1024) {
        buffer = "";
      }
    });
    socket.on("error", () => {
      // fx best-effort 上报；单连接失败不影响监听。
    });
    // fx 等单行回包（≤250ms）后关连接；无回包则它自己超时关闭。
    socket.write('{"ok":true}\n');
  }

  function ensureStarted(): void {
    if (server || disposed) {
      return;
    }
    try {
      mkdirSync(join(socketPath, ".."), { recursive: true });
      // Node 不在 close 时删 socket 文件：先清上次退出的残留，否则 EADDRINUSE
      // 后监听静默死亡（与 local-control server 同纪律）。
      if (process.platform !== "win32" && existsSync(socketPath)) {
        try {
          unlinkSync(socketPath);
        } catch {
          // ignore：listen 失败会走 error 日志
        }
      }
      server = createServer(attachConnection);
      server.on("error", (error) => {
        log.warn("fx herdr listen failed", {
          code:
            error && typeof error === "object" && "code" in error
              ? String(error.code)
              : "unknown",
        });
        server = null;
      });
      server.listen(socketPath, () => {
        try {
          chmodSync(socketPath, 0o600);
        } catch {
          // ignore
        }
      });
    } catch (error) {
      log.warn("fx herdr start failed", {
        code:
          error && typeof error === "object" && "code" in error
            ? String(error.code)
            : "unknown",
      });
      server = null;
    }
  }

  return {
    dispose() {
      disposed = true;
      for (const socket of sockets) {
        socket.destroy();
      }
      sockets.clear();
      server?.close();
      server = null;
      // Node 不删 socket 文件：退出不清则下次 listen 必 EADDRINUSE。
      if (process.platform !== "win32") {
        try {
          if (existsSync(socketPath)) {
            unlinkSync(socketPath);
          }
        } catch {
          // ignore
        }
      }
    },
    env() {
      if (disposed) {
        return {};
      }
      ensureStarted();
      return { HERDR_SOCKET_PATH: socketPath };
    },
    socketPath,
  };
}

export const FX_HERDR_LISTENER_SOURCE = FX_HERDR_SOURCE;
export const FX_HERDR_LISTENER_AGENT = FX_HERDR_AGENT;
