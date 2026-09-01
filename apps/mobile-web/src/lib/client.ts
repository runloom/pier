/**
 * Pier 移动端帧客户端（pier.control/v2 over 原生 WebSocket + JSON 帧）。
 * 帧契约单一来源：@shared/contracts/local-control/frames.ts——出栈帧发送前
 * 先过 schema，入栈帧先 schema 校验再分发。connect 走 client.hello 握手；
 * command 帧往返（ok:false 按 error.code 抛带码错误）；watch 为
 * control.watch request 循环（超时携带游标续接，断线指数退避重连后
 * 重走握手并重新 watch）；close 拒绝全部挂起请求且不再重连。
 */
import type { PierCommand } from "@shared/contracts/commands.ts";
import {
  type ControlSnapshotPayload,
  controlSnapshotPayloadSchema,
} from "@shared/contracts/local-control/control-snapshot.ts";
import { controlCursorScopeSchema } from "@shared/contracts/local-control/cursor.ts";
import { LOCAL_CONTROL_API_VERSION } from "@shared/contracts/local-control/errors.ts";
import {
  type LocalControlServerFrame,
  type LocalControlServerHello,
  localControlClientCommandSchema,
  localControlClientHelloSchema,
  localControlClientRequestSchema,
  localControlServerFrameSchema,
} from "@shared/contracts/local-control/frames.ts";
import {
  CURSOR_RETRY_CODES,
  DEFAULT_RECONNECT_INITIAL_MS,
  DEFAULT_RECONNECT_MAX_MS,
  FATAL_AUTH_CODES,
  type HelloWaiter,
  type MobileConnectionStatus,
  type PendingRequest,
  type PierMobileClientConnectArgs,
  PierMobileClientError,
  type PierMobileClientOptions,
  PierMobileTransportError,
  type PierWebSocketFactory,
  type PierWebSocketLike,
  type WatchState,
} from "./client-types.ts";

export class PierMobileClient {
  private readonly createWebSocket: PierWebSocketFactory;
  private readonly onStatusChange:
    | ((status: MobileConnectionStatus) => void)
    | undefined;
  private readonly random: () => number;
  private readonly reconnectInitialMs: number;
  private readonly reconnectJitterRatio: number;
  private readonly reconnectMaxMs: number;

  private ws: PierWebSocketLike | null = null;
  private connectArgs: PierMobileClientConnectArgs | null = null;
  private serverHello: LocalControlServerHello | null = null;
  private requestSeq = 0;
  private readonly pending = new Map<string, PendingRequest<unknown>>();
  private helloWaiter: HelloWaiter | null = null;
  private watchState: WatchState | null = null;
  private reconnectAttempt = 0;
  private cancelReconnect: (() => void) | null = null;
  /** 进行中的 connect/重连握手承诺：connecting/reconnecting 态重入时复用。 */
  private connectInFlight: Promise<LocalControlServerHello> | null = null;
  private closedByUser = false;
  private fatalAuthError = false;
  private currentStatus: MobileConnectionStatus = "idle";

  constructor(options: PierMobileClientOptions = {}) {
    this.createWebSocket =
      options.createWebSocket ?? ((url) => new WebSocket(url));
    this.random = options.random ?? Math.random;
    this.reconnectInitialMs =
      options.reconnectInitialMs ?? DEFAULT_RECONNECT_INITIAL_MS;
    this.reconnectJitterRatio = options.reconnectJitterRatio ?? 0.3;
    this.reconnectMaxMs = options.reconnectMaxMs ?? DEFAULT_RECONNECT_MAX_MS;
    this.onStatusChange = options.onStatusChange;
  }

  get status(): MobileConnectionStatus {
    return this.currentStatus;
  }

  connect(args: PierMobileClientConnectArgs): Promise<LocalControlServerHello> {
    if (this.serverHello !== null && this.ws !== null) {
      return Promise.resolve(this.serverHello);
    }
    // connecting/reconnecting 态重入：复用进行中承诺，不开第二个 socket
    if (this.connectInFlight !== null) {
      return this.connectInFlight;
    }
    this.connectArgs = args;
    this.closedByUser = false;
    this.fatalAuthError = false;
    // 退避等待中重入：取消挂起重连定时器，立即重走握手
    this.cancelReconnect?.();
    this.cancelReconnect = null;
    this.setStatus("connecting");
    return this.openSocketAndHello();
  }

  /** command 帧往返；ok:false 按 error.code 抛 PierMobileClientError。 */
  command<T>(cmd: PierCommand): Promise<T> {
    const frame = localControlClientCommandSchema.parse({
      apiVersion: LOCAL_CONTROL_API_VERSION,
      type: "command",
      requestId: this.nextRequestId(),
      command: cmd,
    });
    return this.sendWithPending(frame) as Promise<T>;
  }

  /**
   * request 帧往返（control.snapshot / control.watch 等 op；白名单经服务端
   * authorizer 把关）；ok:false 按 error.code 抛带码错误。
   */
  request<T>(op: string, params: Record<string, unknown> = {}): Promise<T> {
    const frame = localControlClientRequestSchema.parse({
      apiVersion: LOCAL_CONTROL_API_VERSION,
      type: "request",
      requestId: this.nextRequestId(),
      op,
      params,
    });
    return this.sendWithPending(frame) as Promise<T>;
  }

  /**
   * control.watch 循环：事件帧 payload 整帧替换回调；服务端超时收束后携带
   * 游标自动续接。承诺在首个快照事件到达时 resolve，此前遇非游标错误码 reject。
   */
  watch(
    onSnapshot: (payload: ControlSnapshotPayload) => void,
    onError?: (error: Error) => void
  ): Promise<void> {
    const state: WatchState = {
      onSnapshot,
      onError,
      after: this.watchState?.after ?? null,
      requestId: null,
      settle: null,
      stopped: false,
    };
    this.watchState = state;
    const promise = new Promise<void>((resolve, reject) => {
      state.settle = { resolve, reject };
    });
    if (this.currentStatus === "connected") {
      this.sendWatchRequest();
    }
    return promise;
  }

  close(): void {
    this.closedByUser = true;
    this.cancelReconnect?.();
    this.cancelReconnect = null;
    this.connectInFlight = null;
    const error = new PierMobileTransportError("client closed");
    this.rejectHelloWaiter(error);
    this.rejectAllPending(error);
    this.watchState?.settle?.reject(error);
    const ws = this.ws;
    this.ws = null;
    this.serverHello = null;
    ws?.close();
    this.setStatus("closed");
  }

  private nextRequestId(): string {
    this.requestSeq += 1;
    return `m-${this.requestSeq}`;
  }

  private openSocketAndHello(): Promise<LocalControlServerHello> {
    const promise = this.dialAndHello();
    this.connectInFlight = promise;
    promise
      .catch(() => undefined)
      .then(() => {
        if (this.connectInFlight === promise) this.connectInFlight = null;
      });
    return promise;
  }

  private setStatus(status: MobileConnectionStatus): void {
    if (this.currentStatus === status) {
      return;
    }
    this.currentStatus = status;
    this.onStatusChange?.(status);
  }

  private dialAndHello(): Promise<LocalControlServerHello> {
    const args = this.connectArgs;
    if (!args) {
      return Promise.reject(
        new PierMobileTransportError("connect() has not been called")
      );
    }
    let ws: PierWebSocketLike;
    try {
      // relay 传输工厂（M2）优先；缺省 dev direct ws://。
      const factory = args.transportFactory ?? this.createWebSocket;
      ws = factory(`ws://${args.host}:${args.port}/ws`);
    } catch (error) {
      return Promise.reject(
        new PierMobileTransportError(
          error instanceof Error ? error.message : "WebSocket create failed"
        )
      );
    }
    this.ws = ws;

    const helloFrame = localControlClientHelloSchema.parse({
      apiVersion: LOCAL_CONTROL_API_VERSION,
      type: "client.hello",
      requestId: this.nextRequestId(),
      clientKind: "mobile-paired",
      auth: {
        method: "device-token",
        deviceId: args.deviceId,
        deviceToken: args.deviceToken,
        shell: "web",
      },
    });

    const { promise, resolve, reject } =
      Promise.withResolvers<LocalControlServerHello>();
    this.helloWaiter = { requestId: helloFrame.requestId, resolve, reject };

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify(helloFrame));
    });
    ws.addEventListener("message", (event) => {
      this.handleMessage(event?.data);
    });
    // error 事件后必跟 close：统一在 close 里结算，避免双 reject。
    ws.addEventListener("close", () => {
      this.handleSocketClose(ws);
    });
    return promise;
  }

  private handleMessage(data: unknown): void {
    let raw: unknown;
    try {
      raw = JSON.parse(typeof data === "string" ? data : String(data));
    } catch {
      return;
    }
    const parsed = localControlServerFrameSchema.safeParse(raw);
    if (!parsed.success) {
      return;
    }
    const frame = parsed.data;
    if (frame.type === "server.hello") {
      this.handleServerHello(frame);
    } else if (frame.type === "response") {
      this.handleResponse(frame);
    } else if (frame.type === "event") {
      this.handleEvent(frame);
    } else {
      this.handleServerError(frame);
    }
  }

  private handleServerHello(frame: LocalControlServerHello): void {
    const waiter = this.helloWaiter;
    if (!waiter || waiter.requestId !== frame.requestId) {
      return;
    }
    this.helloWaiter = null;
    this.serverHello = frame;
    this.reconnectAttempt = 0;
    this.setStatus("connected");
    waiter.resolve(frame);
    // （重）握手完成 → watch 自动（续）发起
    if (this.watchState && !this.watchState.stopped) {
      this.sendWatchRequest();
    }
  }

  private handleResponse(
    frame: Extract<LocalControlServerFrame, { type: "response" }>
  ): void {
    const watch = this.watchState;
    if (watch && frame.requestId === watch.requestId) {
      this.handleWatchResponse(frame);
      return;
    }
    const pending = this.pending.get(frame.requestId);
    if (!pending) {
      return;
    }
    this.pending.delete(frame.requestId);
    if (frame.ok) {
      pending.resolve(frame.data);
    } else {
      pending.reject(
        new PierMobileClientError(frame.error.code, frame.error.message)
      );
    }
  }

  private handleWatchResponse(
    frame: Extract<LocalControlServerFrame, { type: "response" }>
  ): void {
    const watch = this.watchState;
    if (!watch) {
      return;
    }
    watch.requestId = null;
    if (frame.ok) {
      // 服务端 timeoutMs 正常收束 → 携带游标续接（control.watch request 循环）
      if (!watch.stopped && this.currentStatus === "connected") {
        this.sendWatchRequest();
      }
      return;
    }
    const error = new PierMobileClientError(
      frame.error.code,
      frame.error.message
    );
    if (CURSOR_RETRY_CODES[frame.error.code]) {
      // 游标失效：丢游标重新全量；初始承诺保持未决，等首个快照事件
      watch.after = null;
      if (!watch.stopped && this.currentStatus === "connected") {
        this.sendWatchRequest();
      }
      return;
    }
    if (FATAL_AUTH_CODES[frame.error.code]) {
      // 令牌吊销（M3）：立即置 fatal，断连后不再退避重连多走一轮
      this.fatalAuthError = true;
    }
    this.stopWatch(error);
  }

  /** 终止 watch：结算初始承诺或回调 onError，承诺不悬挂。 */
  private stopWatch(error: Error): void {
    const watch = this.watchState;
    if (!watch || watch.stopped) {
      return;
    }
    watch.stopped = true;
    if (watch.settle) {
      watch.settle.reject(error);
      watch.settle = null;
    } else {
      watch.onError?.(error);
    }
  }

  private handleEvent(
    frame: Extract<LocalControlServerFrame, { type: "event" }>
  ): void {
    const watch = this.watchState;
    if (!watch || frame.subscriptionId !== watch.requestId) {
      return;
    }
    const payload = controlSnapshotPayloadSchema.safeParse(frame.payload);
    if (!payload.success) {
      // 契约漂移：丢帧不炸 UI（下一条事件仍可能可解析）
      return;
    }
    const scope = controlCursorScopeSchema.safeParse(frame.cursorScope);
    watch.after = {
      bootId: frame.bootId,
      revision: frame.revision,
      ...(scope.success ? { scope: scope.data } : {}),
    };
    if (watch.settle) {
      watch.settle.resolve();
      watch.settle = null;
    }
    watch.onSnapshot(payload.data);
  }

  private handleServerError(
    frame: Extract<LocalControlServerFrame, { type: "server.error" }>
  ): void {
    const error = new PierMobileClientError(frame.code, frame.message);
    this.rejectHelloWaiter(error);
    this.rejectAllPending(error);
    if (FATAL_AUTH_CODES[frame.code]) {
      // 令牌失效/吊销：随后的断连不再重连（规格 §17.1），
      // 同时结算并终止 watch，watch() 承诺不得悬挂（M2）
      this.fatalAuthError = true;
      this.stopWatch(error);
    }
  }

  private handleSocketClose(ws: PierWebSocketLike): void {
    if (this.ws !== ws) {
      // 陈旧 socket 的迟到 close（重连竞态），忽略
      return;
    }
    this.ws = null;
    this.serverHello = null;
    const error = new PierMobileTransportError("connection closed");
    this.rejectHelloWaiter(error);
    this.rejectAllPending(error);
    if (this.watchState) {
      this.watchState.requestId = null;
    }
    if (this.closedByUser || this.fatalAuthError || !this.connectArgs) {
      this.setStatus("closed");
      return;
    }
    // 指数退避重连：initial × 2^n，封顶 max；加性抖动打散重拨风暴
    this.setStatus("reconnecting");
    const base = Math.min(
      this.reconnectInitialMs * 2 ** this.reconnectAttempt,
      this.reconnectMaxMs
    );
    const delay = Math.round(
      base * (1 + this.reconnectJitterRatio * this.random())
    );
    this.reconnectAttempt += 1;
    const timer = setTimeout(() => {
      this.cancelReconnect = null;
      // hello 失败经 close 事件结算；此处吞掉避免未处理 rejection
      this.openSocketAndHello().catch(() => undefined);
    }, delay);
    this.cancelReconnect = () => clearTimeout(timer);
  }

  private sendWatchRequest(): void {
    const watch = this.watchState;
    const ws = this.ws;
    if (!watch || watch.stopped || !ws) {
      return;
    }
    const params: Record<string, unknown> = {};
    if (watch.after) {
      params.after = watch.after;
    }
    const frame = localControlClientRequestSchema.parse({
      apiVersion: LOCAL_CONTROL_API_VERSION,
      type: "request",
      requestId: this.nextRequestId(),
      op: "control.watch",
      params,
    });
    watch.requestId = frame.requestId;
    ws.send(JSON.stringify(frame));
  }

  private sendWithPending(frame: { requestId: string }): Promise<unknown> {
    const ws = this.ws;
    if (!ws || this.currentStatus !== "connected") {
      return Promise.reject(new PierMobileTransportError("not connected"));
    }
    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    this.pending.set(frame.requestId, { resolve, reject });
    ws.send(JSON.stringify(frame));
    return promise;
  }

  private rejectHelloWaiter(error: Error): void {
    const waiter = this.helloWaiter;
    if (!waiter) {
      return;
    }
    this.helloWaiter = null;
    waiter.reject(error);
  }

  private rejectAllPending(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}
