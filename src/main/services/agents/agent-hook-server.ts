import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import {
  type AgentHookEvent,
  agentHookEventSchema,
} from "@shared/contracts/agent-session.ts";

const MAX_BODY_BYTES = 16 * 1024;

export interface AgentHookServer {
  close(): Promise<void>;
  port: number;
  token: string;
}

/**
 * Agent hook loopback 服务器。
 *
 * 只绑 127.0.0.1 + 随机端口 + 每次启动一次性 Bearer token（经 PTY 环境变量
 * 下发给 agent hook 脚本）。收 POST /agent-event，zod 校验后回调。
 *
 * 安全模型（已接受）：token 对同用户进程可见（env/进程参数可读）；
 * windowId/panelId 为调用方自报——伪造仅影响 UI 展示，不涉及权限越界。
 */
export function startAgentHookServer(
  onEvent: (event: AgentHookEvent) => void
): Promise<AgentHookServer> {
  const token = randomUUID();
  const server = createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/agent-event") {
      res.statusCode = 404;
      res.end();
      return;
    }
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.statusCode = 401;
      res.end();
      return;
    }
    req.on("error", () => {
      // 客户端中途断开(curl 超时/被杀)——静默丢弃, 防 uncaughtException 击穿主进程。
    });
    let size = 0;
    let overflowed = false;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        overflowed = true;
        res.statusCode = 413;
        res.end();
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (overflowed) {
        return;
      }
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        res.statusCode = 400;
        res.end();
        return;
      }
      const parsed = agentHookEventSchema.safeParse(parsedJson);
      if (!parsed.success) {
        res.statusCode = 400;
        res.end();
        return;
      }
      onEvent(parsed.data);
      res.statusCode = 204;
      res.end();
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        reject(new Error("agent-hook-server: no port assigned"));
        return;
      }
      resolve({
        close: () =>
          new Promise<void>((r) => {
            server.close(() => r());
          }),
        port: addr.port,
        token,
      });
    });
  });
}
