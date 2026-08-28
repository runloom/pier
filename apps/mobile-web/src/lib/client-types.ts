/**
 * Pier 移动端帧客户端的纯声明：错误类型、连接配置类型与共享常量。
 * 实现见同目录 client.ts。
 */
import type { ControlSnapshotPayload } from "@shared/contracts/local-control/control-snapshot.ts";
import type { ControlCursorAfterObject } from "@shared/contracts/local-control/cursor.ts";
import type { LocalControlErrorCode } from "@shared/contracts/local-control/errors.ts";
import type { LocalControlServerHello } from "@shared/contracts/local-control/frames.ts";

/** ok:false 响应 / server.error 对应的带码错误（协议稳定错误码）。 */
export class PierMobileClientError extends Error {
  readonly code: LocalControlErrorCode;

  constructor(code: LocalControlErrorCode, message: string) {
    super(message);
    this.name = "PierMobileClientError";
    this.code = code;
  }
}

/** 传输层失败（连接失败 / 断线 / 主动关闭）——无协议错误码。 */
export class PierMobileTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PierMobileTransportError";
  }
}

export type PierWebSocketEventType = "open" | "message" | "close" | "error";

/** 结构化最小 WebSocket 接口：浏览器原生 WebSocket 直接满足；测试注入 mock。 */
export interface PierWebSocketLike {
  addEventListener(
    type: PierWebSocketEventType,
    listener: (event?: { data?: unknown }) => void
  ): void;
  close(): void;
  removeEventListener(
    type: PierWebSocketEventType,
    listener: (event?: { data?: unknown }) => void
  ): void;
  send(data: string): void;
}

export type PierWebSocketFactory = (url: string) => PierWebSocketLike;

export type MobileConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "closed";

export interface PierMobileClientConnectArgs {
  deviceId: string;
  deviceToken: string;
  host: string;
  port: number;
}

export interface PierMobileClientOptions {
  /** 测试 seam：注入 mock；缺省用原生 WebSocket。 */
  createWebSocket?: PierWebSocketFactory;
  onStatusChange?: (status: MobileConnectionStatus) => void;
  /** 断线重连退避：initial 起步、每次翻倍、封顶 max。 */
  reconnectInitialMs?: number;
  reconnectMaxMs?: number;
}

export interface PendingRequest<T> {
  reject: (error: Error) => void;
  resolve: (data: T) => void;
}

export interface HelloWaiter extends PendingRequest<LocalControlServerHello> {
  requestId: string;
}

export interface WatchState {
  /** 最近事件游标：超时续接 / 重连 resume 用；游标失效时清空重新全量。 */
  after: ControlCursorAfterObject | null;
  onError: ((error: Error) => void) | undefined;
  onSnapshot: (payload: ControlSnapshotPayload) => void;
  requestId: string | null;
  /** 首个事件到达前的初始承诺；到达后清空。 */
  settle: { resolve: () => void; reject: (error: Error) => void } | null;
  /** 非游标类错误后停流，避免热循环重试。 */
  stopped: boolean;
}

export const DEFAULT_RECONNECT_INITIAL_MS = 500;
export const DEFAULT_RECONNECT_MAX_MS = 10_000;

/** 令牌失效/吊销：断连后不再重连（规格 §17.1）。 */
export const FATAL_AUTH_CODES: Readonly<
  Partial<Record<LocalControlErrorCode, true>>
> = {
  auth_failed: true,
  device_revoked: true,
};
/** 游标类错误：丢游标重新全量即可恢复。 */
export const CURSOR_RETRY_CODES: Readonly<
  Partial<Record<LocalControlErrorCode, true>>
> = {
  boot_changed: true,
  snapshot_required: true,
};
