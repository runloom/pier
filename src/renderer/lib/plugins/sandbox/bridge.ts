import type { PierCapability } from "@shared/contracts/permissions.ts";
import {
  BRIDGE_CALL_TIMEOUT_MS,
  BRIDGE_MAX_CONCURRENT_CALLS,
  type BridgeCallFrame,
  type BridgeErrorCode,
  type BridgeFrame,
  type BridgeMethodDescriptor,
  parseBridgeFrame,
} from "@shared/contracts/plugin/bridge.ts";

/**
 * 沙箱轨能力桥宿主侧核心（Phase 2 M2）。
 *
 * 与传输解耦：构造时注入 `send`（真实场景 = iframe.contentWindow.postMessage，
 * 测试 = spy）。所有上行帧经令牌校验 + 协议状态机 + 能力检查后才派发；
 * 任何协议违规冻结整座桥（fail-closed）。
 */

/** 单桥实例的拒绝审计上限：防恶意刷日志，同时保留足够取证样本。 */
const SANDBOX_AUDIT_DENIAL_LIMIT = 20;

export type SandboxBridgeState =
  | "awaiting-hello"
  | "ready"
  | "disposed"
  | "frozen";

export interface SandboxBridgeOptions {
  /** 可订阅广播白名单（缺省 = 全部不订阅）。 */
  allowedChannels?: readonly string[];
  /** 该插件 manifest 授权的能力集（安装期已验签）。 */
  grantedCapabilities: readonly PierCapability[];
  /** deny-by-default 的方法注册表。 */
  methods: ReadonlyMap<string, BridgeMethodDescriptor>;
  /** 审计回调：denied/frozen 事件转发 main 操作日志（限流由宿主负责）。 */
  onAudit?: (event: {
    detail: string;
    event: "call-denied" | "frozen";
  }) => void;
  onDisposed?: () => void;
  /** 协议违规冻结回调（宿主应拆除 iframe 并上报诊断）。 */
  onFrozen?: (reason: string) => void;
  pluginId: string;
  send: (frame: BridgeFrame) => void;
  /** 宿主注入引导脚本的一次性令牌；上行帧必须回带。 */
  token: string;
}

interface PendingCall {
  timer: ReturnType<typeof setTimeout>;
}

export class SandboxBridge {
  private readonly allowedChannels: readonly string[];
  private readonly options: SandboxBridgeOptions;
  private state: SandboxBridgeState = "awaiting-hello";
  private readonly pending = new Map<number, PendingCall>();
  private readonly subscribedChannels = new Set<string>();
  private frozenReason: string | null = null;

  constructor(options: SandboxBridgeOptions) {
    this.allowedChannels = options.allowedChannels ?? [];
    this.options = options;
  }

  getState(): SandboxBridgeState {
    return this.state;
  }

  getFrozenReason(): string | null {
    return this.frozenReason;
  }

  /** 传输层入口：收到来自该 iframe 的原始消息时调用。 */
  handleIncoming(raw: unknown): void {
    if (this.state === "frozen") return;
    const frame = parseBridgeFrame(raw);
    if (!frame) {
      this.freeze("unparseable or oversized frame");
      return;
    }
    const uplinkToken = "token" in frame ? frame.token : undefined;
    if (
      typeof uplinkToken !== "string" ||
      !safeEqual(uplinkToken, this.options.token)
    ) {
      this.freeze("token mismatch");
      return;
    }
    // hello 之外的所有帧都必须已建立会话。
    if (frame.t !== "hello" && this.state !== "ready") {
      this.freeze(`frame "${frame.t}" before handshake`);
      return;
    }
    switch (frame.t) {
      case "hello":
        this.handleHello(frame.token);
        return;
      case "call":
        this.handleCall(frame);
        return;
      case "subscribe":
        this.handleSubscribe(frame.channel);
        return;
      case "disposed":
        this.dispose();
        return;
      default:
        // event/result 是下行帧；插件上行一律视为协议违规。
        this.freeze(`unexpected uplink frame "${frame.t}"`);
    }
  }

  /** 宿主在 iframe 自导航等情况下拆除；与协议违规同路径。 */
  freezeFromHost(reason: string): void {
    this.freeze(reason);
  }

  /** 宿主向已订阅通道推送广播。未订阅的通道静默丢弃。 */
  pushEvent(channel: string, payload: BridgeCallFrame["params"]): void {
    if (this.state !== "ready" || !this.subscribedChannels.has(channel)) {
      return;
    }
    this.send({ t: "event", channel, payload: payload as never });
  }

  /** 宿主发起销毁：下发 dispose，等待插件 ack（或直接由宿主拆 iframe）。 */
  dispose(): void {
    if (this.state === "disposed") return;
    const wasReady = this.state === "ready";
    this.state = "disposed";
    this.cancelAllPending("internal_error");
    if (wasReady) {
      this.send({ t: "disposed" });
    }
    this.options.onDisposed?.();
  }

  private handleHello(token: string): void {
    if (this.state !== "awaiting-hello") {
      this.freeze("duplicate handshake");
      return;
    }
    if (!safeEqual(token, this.options.token)) {
      this.freeze("token mismatch");
      return;
    }
    this.state = "ready";
    this.send({ t: "ready", proto: 1 });
  }

  private handleCall(frame: BridgeCallFrame): void {
    const { method } = frame;
    const descriptor = this.options.methods.get(method);
    if (!descriptor) {
      this.replyError(frame.id, "unknown_method", `unknown method: ${method}`);
      return;
    }
    const missing = descriptor.capabilities.filter(
      (capability) => !this.options.grantedCapabilities.includes(capability)
    );
    if (missing.length > 0) {
      this.replyError(frame.id, "denied", `missing capability: ${missing[0]}`);
      return;
    }
    if (this.pending.size >= BRIDGE_MAX_CONCURRENT_CALLS) {
      this.replyError(frame.id, "denied", "concurrency limit reached");
      return;
    }
    const timer = setTimeout(() => {
      this.settle(frame.id, {
        ok: false,
        error: { code: "timeout", message: `call timed out: ${method}` },
      });
    }, BRIDGE_CALL_TIMEOUT_MS);
    this.pending.set(frame.id, { timer });
    Promise.resolve()
      .then(() => descriptor.handler(frame.params))
      .then(
        (data) => {
          this.settle(frame.id, { data, ok: true });
        },
        (error: unknown) => {
          this.settle(frame.id, {
            error: {
              code: "internal_error",
              message:
                error instanceof Error ? error.message : String(error ?? ""),
            },
            ok: false,
          });
        }
      );
  }

  private handleSubscribe(channel: string): void {
    if (this.allowedChannels.includes(channel)) {
      this.subscribedChannels.add(channel);
    }
    // 白名单外静默忽略：不给探测面。
  }

  private settle(
    id: number,
    outcome:
      | { data: BridgeCallFrame["params"]; ok: true }
      | { error: { code: BridgeErrorCode; message: string }; ok: false }
  ): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    if (!outcome.ok) {
      this.send({
        t: "result",
        id,
        ok: false,
        error: outcome.error,
      });
      return;
    }
    this.send({ t: "result", id, ok: true, data: outcome.data });
  }

  private denialAuditCount = 0;

  private replyError(id: number, code: BridgeErrorCode, message: string): void {
    this.send({ t: "result", id, ok: false, error: { code, message } });
    if (
      code === "denied" &&
      this.denialAuditCount < SANDBOX_AUDIT_DENIAL_LIMIT
    ) {
      this.denialAuditCount += 1;
      this.options.onAudit?.({ detail: message, event: "call-denied" });
    }
  }

  private cancelAllPending(code: BridgeErrorCode): void {
    for (const [id, pending] of [...this.pending.entries()]) {
      clearTimeout(pending.timer);
      this.pending.delete(id);
      this.send({
        t: "result",
        id,
        ok: false,
        error: { code, message: "bridge disposed" },
      });
    }
  }

  private freeze(reason: string): void {
    if (this.state === "frozen") return;
    this.state = "frozen";
    this.frozenReason = reason;
    this.cancelAllPending("internal_error");
    this.options.onFrozen?.(reason);
    this.options.onAudit?.({ detail: reason, event: "frozen" });
  }

  private send(frame: BridgeFrame): void {
    this.options.send(frame);
  }
}

/** 常量时间字符串比较（令牌校验），避免时序侧信道。 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch += a.charCodeAt(i) === b.charCodeAt(i) ? 0 : 1;
  }
  return mismatch === 0;
}
