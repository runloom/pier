/**
 * 移动端会话桥：一条 WS 连接 = 一次 hello 认证 + 一个 v2 会话 + command 通道。
 *
 * 消息分三类：
 * 1. 首帧必须是 client.hello 且 clientKind mobile-paired，否则
 *    protocol_unsupported + close（协议错误，不计入认证失败限速）。
 *    认证在会话层 resolveHelloPrincipal 内经注入的 MobileAuthenticator
 *    （包装 PairingService.authenticate）完成；失败 → auth_failed +
 *    recordFailure(remoteAddress) + close；成功 → recordSuccess +
 *    clients.register(mobile:<deviceId>) + touchLastSeen + 回 server.hello。
 * 2. type "command" 帧 → 先 assertEpochCurrent（epoch 门），失配 →
 *    device_revoked response + close；通过 → executeCommand(envelope) →
 *    PierCommandResult 包成 v2 response 帧。
 * 3. 其它帧原文转 session.handleLine（watch/snapshot 走 mobile authorizer
 *    的 epoch 门）。
 *
 * 构造期订阅 pairing.onRevoke：命中本会话设备立即 device_revoked + close。
 * close 时退订、session.dispose()、clients.unregister()。
 */
import type { PierClientRegistry } from "@main/app-core/client-registry.ts";
import type { PairingService } from "@main/services/pairing/service.ts";
import {
  type PierCommandEnvelope,
  type PierCommandResult,
  pierCommandSchema,
} from "@shared/contracts/commands.ts";
import {
  LOCAL_CONTROL_API_VERSION,
  LOCAL_CONTROL_ERROR_CODES,
  type LocalControlErrorCode,
} from "@shared/contracts/local-control/errors.ts";
import {
  type LocalControlServerFrame,
  localControlClientCommandSchema,
  localControlClientHelloSchema,
} from "@shared/contracts/local-control/frames.ts";
import type { PierPairedDevice } from "@shared/contracts/remote.ts";
import type { WebSocket as WsWebSocket } from "ws";
import { controlErrorResponse } from "../cli/local-control/discovery.ts";
import { serverErrorFrame } from "../cli/local-control/features.ts";
import type { MobileAuthenticator } from "../cli/local-control/hello-auth.ts";
import {
  type CreateLocalControlSessionArgs,
  createLocalControlSessionFromHello,
  type LocalControlSession,
} from "../cli/local-control/session.ts";
import { createMobileAuthorizer } from "./mobile-authorizer.ts";

/** ws RawData 的最小结构：桥只关心「字节 → 原文行」。 */
export type WebSocketMessageData = string | Buffer | ArrayBuffer | Buffer[];

export interface WebSocketLike {
  close(code?: number, reason?: string): void;
  on(event: "message", listener: (data: WebSocketMessageData) => void): void;
  on(event: "close", listener: () => void): void;
  send(data: string): void;
}

/** 编译期校验：装配侧可直接把 ws.WebSocket 传给桥。 */
type AssertWsCompatible = WsWebSocket extends WebSocketLike ? true : never;
export type _AssertWsCompatible = AssertWsCompatible;

export interface AttachMobileSessionContext {
  clients: PierClientRegistry;
  executeCommand: (envelope: PierCommandEnvelope) => Promise<unknown>;
  pairing: PairingService;
  /** 与 server 层 per-IP 限速计数器共用（POST /pair 同口径）。 */
  recordFailure(remoteAddress: string): void;
  recordSuccess(remoteAddress: string): void;
  remoteAddress: string;
  sessionDeps: Omit<CreateLocalControlSessionArgs, "authorizer" | "emit">;
  sessionTracker?: MobileSessionTracker | undefined;
}

/**
 * 同 deviceId 并发 hello 裁决（Task 7 终审 M1「最新者胜」）：registry 单槽
 * 会互相抹除，装配层按 deviceId 追踪活跃会话；新 hello 认证成功即先对旧
 * 连接发 device_revoked server.error + close，再接受新连接。
 */
export interface MobileSessionTracker {
  /** 认证成功后登记新会话；同设备已有旧会话则先顶替（evict 旧连接）。 */
  claim(deviceId: string, evict: () => void): void;
  /** 连接关闭时注销；返回 false = 已被更新会话顶替（不得回滚其注册态）。 */
  release(deviceId: string, evict: () => void): boolean;
}

export function createMobileSessionTracker(): MobileSessionTracker {
  const active = new Map<string, () => void>();
  return {
    claim(deviceId, evict) {
      const previous = active.get(deviceId);
      if (previous) {
        // 先摘除再顶替：旧连接随后的 close 释放不得命中新登记。
        active.delete(deviceId);
        previous();
      }
      active.set(deviceId, evict);
    },
    release(deviceId, evict) {
      if (active.get(deviceId) !== evict) {
        return false;
      }
      active.delete(deviceId);
      return true;
    },
  };
}

const LOCAL_CONTROL_ERROR_CODE_TABLE = Object.fromEntries(
  LOCAL_CONTROL_ERROR_CODES.map((code) => [code, true])
) as Record<string, true>;

function toLine(data: WebSocketMessageData): string {
  if (typeof data === "string") {
    return data;
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  return data.toString("utf8");
}

/** v1 命令错误码 → v2 稳定码；v2 码表之外的一律折叠 internal_error。 */
function toLocalControlErrorCode(code: string): LocalControlErrorCode {
  if (LOCAL_CONTROL_ERROR_CODE_TABLE[code]) {
    return code as LocalControlErrorCode;
  }
  return "internal_error";
}

function isCommandResult(value: unknown): value is PierCommandResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.ok === true) {
    return true;
  }
  if (record.ok !== false) {
    return false;
  }
  const error = record.error;
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const errorRecord = error as Record<string, unknown>;
  return (
    typeof errorRecord.code === "string" &&
    typeof errorRecord.message === "string"
  );
}

function commandResultFrame(
  requestId: string,
  result: unknown
): LocalControlServerFrame {
  if (!isCommandResult(result)) {
    return controlErrorResponse(
      requestId,
      "internal_error",
      "executeCommand returned malformed result"
    );
  }
  if (result.ok) {
    return {
      apiVersion: LOCAL_CONTROL_API_VERSION,
      type: "response",
      requestId,
      ok: true,
      data: result.data,
    };
  }
  return controlErrorResponse(
    requestId,
    toLocalControlErrorCode(result.error.code),
    result.error.message
  );
}

export function attachMobileSession(
  ws: WebSocketLike,
  ctx: AttachMobileSessionContext
): void {
  let closed = false;
  let session: LocalControlSession | null = null;
  /** 认证成功后由 authenticateMobile 闭包落定；epoch 门以此时快照为准。 */
  let device: PierPairedDevice | null = null;

  const sendFrame = (frame: LocalControlServerFrame): void => {
    if (!closed) {
      ws.send(JSON.stringify(frame));
    }
  };

  /** 被同设备新会话顶替：device_revoked + 断连（「最新者胜」，装配层裁决）。 */
  const evictSelf = (): void => {
    sendFrame(
      serverErrorFrame("device_revoked", "superseded by a newer session")
    );
    ws.close();
  };

  // 构造期订阅吊销：命中本会话设备即踢连；退订在 close。
  const unsubscribeRevoke = ctx.pairing.onRevoke((revokedDeviceId) => {
    if (device !== null && revokedDeviceId === device.deviceId) {
      sendFrame(serverErrorFrame("device_revoked", "paired device revoked"));
      ws.close();
    }
  });

  const authenticateMobile: MobileAuthenticator = (auth) => {
    const result = ctx.pairing.authenticate(auth.deviceId, auth.deviceToken);
    if (!result.ok) {
      return { ok: false };
    }
    device = result.device;
    return { ok: true, principalRef: `mobile:${result.device.deviceId}` };
  };

  const epochGate = (): boolean =>
    device !== null &&
    ctx.pairing.assertEpochCurrent(device.deviceId, device.tokenEpoch);

  function handleFirstFrame(raw: unknown): void {
    const parsed = localControlClientHelloSchema.safeParse(raw);
    if (!parsed.success || parsed.data.clientKind !== "mobile-paired") {
      sendFrame(
        serverErrorFrame(
          "protocol_unsupported",
          "first frame must be client.hello with clientKind mobile-paired"
        )
      );
      ws.close();
      return;
    }
    const created = createLocalControlSessionFromHello(parsed.data, {
      ...ctx.sessionDeps,
      authenticateMobile,
      authorizer: createMobileAuthorizer(epochGate),
      emit: sendFrame,
    });
    if (!created.ok) {
      // schema 合法的 mobile hello 在会话层唯一的失败源就是认证。
      ctx.recordFailure(ctx.remoteAddress);
      sendFrame(created.errorFrame);
      ws.close();
      return;
    }
    const authenticated = device;
    if (authenticated === null) {
      // 不可达：principal 只能经 authenticateMobile 成功解析。
      sendFrame(
        serverErrorFrame(
          "internal_error",
          "mobile authenticator yielded no device"
        )
      );
      ws.close();
      return;
    }
    ctx.recordSuccess(ctx.remoteAddress);
    ctx.sessionTracker?.claim(authenticated.deviceId, evictSelf);
    ctx.clients.register({
      id: `mobile:${authenticated.deviceId}`,
      kind: "mobile-paired",
      capabilities: [...authenticated.capabilities],
      createdAt: authenticated.createdAt,
      lastSeenAt: authenticated.lastSeenAt,
    });
    ctx.pairing.touchLastSeen(authenticated.deviceId);
    session = created.session;
    sendFrame(created.helloFrame);
  }

  function handleCommandFrame(raw: unknown, line: string): void {
    const authed = device;
    const established = session;
    if (authed === null || established === null) {
      return;
    }
    const parsed = localControlClientCommandSchema.safeParse(raw);
    if (!parsed.success) {
      // 畸形帧交回会话层产统一 invalid_command 错误。
      established.handleLine(line);
      return;
    }
    const frame = parsed.data;
    if (!ctx.pairing.assertEpochCurrent(authed.deviceId, authed.tokenEpoch)) {
      sendFrame(
        controlErrorResponse(
          frame.requestId,
          "device_revoked",
          "paired device revoked or token epoch stale"
        )
      );
      ws.close();
      return;
    }
    const command = pierCommandSchema.safeParse(frame.command);
    if (!command.success) {
      sendFrame(
        controlErrorResponse(
          frame.requestId,
          "invalid_command",
          command.error.issues[0]?.message ?? "invalid command payload"
        )
      );
      return;
    }
    ctx.pairing.touchLastSeen(authed.deviceId);
    ctx
      .executeCommand({
        protocolVersion: 1,
        requestId: frame.requestId,
        clientId: `mobile:${authed.deviceId}`,
        command: command.data,
      })
      .then((result) => {
        sendFrame(commandResultFrame(frame.requestId, result));
      })
      .catch((error: unknown) => {
        sendFrame(
          controlErrorResponse(
            frame.requestId,
            "internal_error",
            error instanceof Error ? error.message : String(error)
          )
        );
      });
  }

  ws.on("message", (data) => {
    if (closed) {
      return;
    }
    const line = toLine(data);
    if (session === null) {
      let raw: unknown = null;
      try {
        raw = JSON.parse(line);
      } catch {
        raw = null;
      }
      handleFirstFrame(raw);
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      session.handleLine(line);
      return;
    }
    if (
      typeof raw === "object" &&
      raw !== null &&
      (raw as { type?: unknown }).type === "command"
    ) {
      handleCommandFrame(raw, line);
      return;
    }
    session.handleLine(line);
  });

  ws.on("close", () => {
    closed = true;
    unsubscribeRevoke();
    session?.dispose();
    if (device !== null) {
      // 被顶替的旧连接不得注销新会话的 registry 注册（「最新者胜」）。
      const owned =
        ctx.sessionTracker?.release(device.deviceId, evictSelf) ?? true;
      if (owned) {
        ctx.clients.unregister(`mobile:${device.deviceId}`);
      }
    }
  });
}
