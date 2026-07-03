import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import {
  type AgentHookEvent,
  agentHookEventSchema,
  type TerminalCommandStartEvent,
  terminalCommandStartSchema,
} from "@shared/contracts/agent-session.ts";

const MAX_BODY_BYTES = 16 * 1024;
const MAX_COMMAND_LINE = 4096;

export interface AgentHookServer {
  close(): Promise<void>;
  port: number;
  token: string;
}

function readBody(
  req: IncomingMessage,
  res: ServerResponse,
  onDone: (body: Buffer) => void
): void {
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
    onDone(Buffer.concat(chunks));
  });
}

function handleAgentEvent(
  body: Buffer,
  res: ServerResponse,
  onEvent: (event: AgentHookEvent) => void
): void {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(body.toString("utf8"));
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
}

/**
 * 命令行走 raw text body（shell 侧免 JSON 转义）, 路由字段走请求头。
 * 超长命令截断而非拒绝——身份信息在行首, 尾部无关。
 */
function handleCommandEvent(
  req: IncomingMessage,
  body: Buffer,
  res: ServerResponse,
  onCommand: (event: TerminalCommandStartEvent) => void
): void {
  const panelId = req.headers["x-pier-panel-id"];
  const windowId = req.headers["x-pier-window-id"];
  const parsed = terminalCommandStartSchema.safeParse({
    v: 1,
    commandLine: body.toString("utf8").slice(0, MAX_COMMAND_LINE),
    panelId,
    windowId,
  });
  if (!parsed.success) {
    res.statusCode = 400;
    res.end();
    return;
  }
  onCommand(parsed.data);
  res.statusCode = 204;
  res.end();
}

/**
 * Agent hook loopback 服务器。
 *
 * 只绑 127.0.0.1 + 随机端口 + 每次启动一次性 Bearer token（经 PTY 环境变量
 * 下发给 agent hook 脚本与 shell preexec 上报）。路由：
 * - POST /agent-event   JSON hook 事件（zod 校验后回调）
 * - POST /command-event 前台命令开始（headers 路由 + raw body 命令行）
 *
 * 安全模型（已接受）：token 对同用户进程可见（env/进程参数可读）；
 * windowId/panelId 为调用方自报——伪造仅影响 UI 展示，不涉及权限越界。
 */
export function startAgentHookServer(
  onEvent: (event: AgentHookEvent) => void,
  onCommand: (event: TerminalCommandStartEvent) => void = () => undefined
): Promise<AgentHookServer> {
  const token = randomUUID();
  const server = createServer((req, res) => {
    const isAgentEvent = req.url === "/agent-event";
    const isCommandEvent = req.url === "/command-event";
    if (req.method !== "POST" || !(isAgentEvent || isCommandEvent)) {
      res.statusCode = 404;
      res.end();
      return;
    }
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.statusCode = 401;
      res.end();
      return;
    }
    readBody(req, res, (body) => {
      if (isAgentEvent) {
        handleAgentEvent(body, res, onEvent);
      } else {
        handleCommandEvent(req, body, res, onCommand);
      }
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
