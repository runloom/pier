import { type ChildProcess, spawn } from "node:child_process";
import { parseRateLimitsResult } from "./rate-limits.ts";
import type { AccountUsageResult } from "./types.ts";

export { parseRateLimitsResult } from "./rate-limits.ts";

const RPC_TIMEOUT_MS = 15_000;

/** 可注入 spawn（单测用假子进程驱动 JSON-RPC 状态机）。 */
export type SpawnFn = (
  cmd: string,
  args: string[],
  opts: {
    env?: NodeJS.ProcessEnv;
    stdio: ["pipe", "pipe", "pipe"];
    windowsHide: boolean;
  }
) => ChildProcess;

/**
 * 构造 JSON-RPC 2.0 请求消息（换行分隔协议）。
 */
function buildRpcMessage(id: number, method: string, params?: unknown): string {
  return `${JSON.stringify({ id, jsonrpc: "2.0", method, params: params ?? {} })}\n`;
}

/**
 * spawn `codex app-server` 走 JSON-RPC 协议获取活跃账号用量。
 *
 * 协议序列（本机 codex-cli 0.142.5 实测）：
 * 1. 发 `initialize` 请求（clientInfo: { name: "pier", version: "1.0.0" }），等响应
 * 2. 发 `initialized` 通知
 * 3. 发 `account/rateLimits/read` 请求，读响应
 * 消息为换行分隔 JSON-RPC 2.0；服务端会发无 id 的通知，跳过即可。
 */
export function fetchCodexUsage(
  signal: AbortSignal,
  opts?: { accountHomeDir?: string; spawnImpl?: SpawnFn }
): Promise<AccountUsageResult> {
  if (signal.aborted) {
    return Promise.resolve({ status: "error", error: "Aborted", windows: [] });
  }
  const spawnImpl = opts?.spawnImpl ?? spawn;

  return new Promise<AccountUsageResult>((resolve) => {
    let buffer = "";
    let resolved = false;
    let rpcId = 0;

    const child = spawnImpl(
      "codex",
      ["-s", "read-only", "-a", "untrusted", "app-server"],
      {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        env: opts?.accountHomeDir
          ? { ...process.env, CODEX_HOME: opts.accountHomeDir }
          : process.env,
      }
    );

    let timeout: ReturnType<typeof setTimeout> | null = null;

    function cleanupListeners(): void {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      signal.removeEventListener("abort", onAbort);
      child.stdout?.off("data", onStdoutData);
      child.on?.("error", () => {
        /* swallow: prevent unhandled error after cleanup */
      });
    }

    function settle(
      result: AccountUsageResult,
      opts?: { kill?: boolean }
    ): void {
      if (resolved) {
        return;
      }
      resolved = true;
      cleanupListeners();
      if (opts?.kill) {
        child.kill();
      }
      resolve(result);
    }

    function onAbort(): void {
      settle(
        { status: "error", error: "Aborted", windows: [] },
        { kill: true }
      );
    }

    signal.addEventListener("abort", onAbort, { once: true });

    // stdin 是独立的 Writable EventEmitter：子进程在响应后立即退出时，
    // 下一次 write 触发的 EPIPE 若无 handler 会以 ERR_UNHANDLED_ERROR
    // 炸掉 Electron main —— 收敛为 usage error 态。
    child.stdin?.on("error", () => {
      settle(
        { status: "error", error: "stdin write failed", windows: [] },
        { kill: true }
      );
    });

    timeout = setTimeout(() => {
      settle(
        { status: "error", error: "RPC timeout", windows: [] },
        { kill: true }
      );
    }, RPC_TIMEOUT_MS);

    function sendRpc(method: string, params?: unknown): number {
      const id = ++rpcId;
      child.stdin?.write(buildRpcMessage(id, method, params));
      return id;
    }

    function sendNotification(method: string): void {
      child.stdin?.write(
        `${JSON.stringify({ jsonrpc: "2.0", method, params: {} })}\n`
      );
    }

    let rateLimitsId: number | null = null;
    const initId = sendRpc("initialize", {
      clientInfo: { name: "pier", version: "1.0.0" },
    });

    function handleInitResponse(error?: { message: string }): void {
      // initialize 也可能返回 JSON-RPC error（协议不兼容 / codex 升级后 client
      // 不受支持）。不检查会盲目往下发 initialized + rateLimits，服务端退出后
      // 用户只看到笼统的 "RPC process exited unexpectedly"，真实错误被吞。
      if (error) {
        settle(
          { status: "error", error: error.message, windows: [] },
          { kill: true }
        );
        return;
      }
      sendNotification("initialized");
      rateLimitsId = sendRpc("account/rateLimits/read");
    }

    function handleRateLimitsResponse(
      error: { message: string } | undefined,
      result: unknown
    ): void {
      if (error) {
        settle(
          { status: "error", error: error.message, windows: [] },
          { kill: true }
        );
        return;
      }
      settle(parseRateLimitsResult(result), { kill: true });
    }

    function processLine(line: string): void {
      if (!line) {
        return;
      }
      let msg: { error?: { message: string }; id?: number; result?: unknown };
      try {
        msg = JSON.parse(line);
      } catch {
        return; // 非 JSON 行——跳过
      }
      if (msg.id == null) {
        return; // 跳过服务端通知（无 id）
      }
      if (msg.id === initId) {
        handleInitResponse(msg.error);
        return;
      }
      if (rateLimitsId !== null && msg.id === rateLimitsId) {
        handleRateLimitsResponse(msg.error, msg.result);
      }
    }

    function onStdoutData(chunk: Buffer): void {
      buffer += chunk.toString();
      for (;;) {
        const idx = buffer.indexOf("\n");
        if (idx === -1) {
          break;
        }
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        processLine(line);
      }
    }

    child.stdout?.on("data", onStdoutData);

    child.on("error", (err) => {
      const isEnoent = (err as NodeJS.ErrnoException).code === "ENOENT";
      settle({
        status: "error",
        error: isEnoent ? "Codex CLI not found" : err.message,
        windows: [],
      });
    });

    child.on("close", () => {
      settle({
        status: "error",
        error: "RPC process exited unexpectedly",
        windows: [],
      });
    });
  });
}
