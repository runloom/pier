import type { ControlSnapshotPayload } from "@shared/contracts/local-control/control-snapshot.ts";
import { LOCAL_CONTROL_API_VERSION } from "@shared/contracts/local-control/errors.ts";
import {
  localControlClientCommandSchema,
  localControlClientHelloSchema,
} from "@shared/contracts/local-control/frames.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PierMobileClient } from "../../../apps/mobile-web/src/lib/client.ts";
import {
  PierMobileClientError,
  type PierWebSocketLike,
} from "../../../apps/mobile-web/src/lib/client-types.ts";

type MockListener = (event?: { data?: unknown }) => void;

class MockWebSocket implements PierWebSocketLike {
  static instances: MockWebSocket[] = [];

  static reset(): void {
    MockWebSocket.instances = [];
  }

  readonly url: string;
  readonly sent: string[] = [];
  closed = false;
  private readonly listeners = new Map<string, Set<MockListener>>();

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
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

  emitOpen(): void {
    this.emit("open");
  }

  emitMessage(frame: unknown): void {
    this.emit("message", { data: JSON.stringify(frame) });
  }

  emitClose(): void {
    this.close();
  }

  private emit(type: string, event?: { data?: unknown }): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

const CONNECT_ARGS = {
  host: "192.168.1.10",
  port: 4455,
  deviceId: "dev-1",
  deviceToken: "tok-1",
};

function createClient(
  options: Partial<ConstructorParameters<typeof PierMobileClient>[0]> = {}
): PierMobileClient {
  return new PierMobileClient({
    createWebSocket: (url) => new MockWebSocket(url),
    // 既有时序断言按精确毫秒锁定：默认关掉抖动，抖动单独测。
    reconnectJitterRatio: 0,
    reconnectInitialMs: 100,
    reconnectMaxMs: 400,
    ...options,
  });
}

function lastSocket(): MockWebSocket {
  const socket = MockWebSocket.instances.at(-1);
  if (!socket) {
    throw new Error("no MockWebSocket instance");
  }
  return socket;
}

function sentFrame(
  socket: MockWebSocket,
  index: number
): Record<string, unknown> {
  const raw = socket.sent.at(index);
  if (raw === undefined) {
    throw new Error(`no frame at index ${index}`);
  }
  return JSON.parse(raw) as Record<string, unknown>;
}

function serverHelloFrame(requestId: unknown, bootId = "boot-1"): unknown {
  return {
    apiVersion: LOCAL_CONTROL_API_VERSION,
    type: "server.hello",
    requestId,
    bootId,
    serverTimeMs: 1,
    features: ["control.watch"],
  };
}

/** 完成 open + hello 握手，返回已连接 socket。 */
async function connectClient(client: PierMobileClient): Promise<MockWebSocket> {
  const promise = client.connect(CONNECT_ARGS);
  const socket = lastSocket();
  socket.emitOpen();
  socket.emitMessage(serverHelloFrame(sentFrame(socket, 0).requestId));
  await promise;
  return socket;
}

function makeSnapshot(
  bootId: string,
  revision: number
): ControlSnapshotPayload {
  return {
    bootId,
    revision,
    capturedAt: 1,
    agents: [],
    activity: [],
    windows: [],
    panels: [],
    worktrees: [],
    tasks: [],
    notifications: [],
    runtimes: [],
  };
}

function snapshotEventFrame(
  subscriptionId: unknown,
  snapshot: ControlSnapshotPayload
): unknown {
  return {
    apiVersion: LOCAL_CONTROL_API_VERSION,
    type: "event",
    subscriptionId,
    bootId: snapshot.bootId,
    revision: snapshot.revision,
    cursorScope: "global",
    mode: "snapshot",
    payload: snapshot,
  };
}

describe("PierMobileClient", () => {
  beforeEach(() => {
    MockWebSocket.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("connect 发送 schema 可过的 client.hello 并解析 server.hello", async () => {
    const client = createClient();
    const promise = client.connect(CONNECT_ARGS);
    const socket = lastSocket();
    expect(socket.url).toBe("ws://192.168.1.10:4455/ws");

    socket.emitOpen();
    expect(socket.sent).toHaveLength(1);
    const frame = sentFrame(socket, 0);
    const parsed = localControlClientHelloSchema.safeParse(frame);
    expect(parsed.success).toBe(true);
    expect(frame.clientKind).toBe("mobile-paired");
    expect(frame.auth).toEqual({
      method: "device-token",
      deviceId: "dev-1",
      deviceToken: "tok-1",
      shell: "web",
    });

    socket.emitMessage(serverHelloFrame(frame.requestId));
    const hello = await promise;
    expect(hello.bootId).toBe("boot-1");
    expect(client.status).toBe("connected");
    client.close();
  });

  it("command 往返：帧过 schema、requestId 自增、data 透传", async () => {
    const client = createClient();
    const socket = await connectClient(client);

    const first = client.command<{ running: boolean }>({ type: "app.status" });
    const firstFrame = sentFrame(socket, 1);
    expect(localControlClientCommandSchema.safeParse(firstFrame).success).toBe(
      true
    );
    expect(firstFrame.command).toEqual({ type: "app.status" });
    expect(firstFrame.requestId).not.toBe(sentFrame(socket, 0).requestId);
    socket.emitMessage({
      apiVersion: LOCAL_CONTROL_API_VERSION,
      type: "response",
      requestId: firstFrame.requestId,
      ok: true,
      data: { running: true },
    });
    await expect(first).resolves.toEqual({ running: true });

    const second = client.command({ type: "app.status" });
    const secondFrame = sentFrame(socket, 2);
    expect(secondFrame.requestId).not.toBe(firstFrame.requestId);
    socket.emitMessage({
      apiVersion: LOCAL_CONTROL_API_VERSION,
      type: "response",
      requestId: secondFrame.requestId,
      ok: true,
      data: null,
    });
    await expect(second).resolves.toBeNull();
    client.close();
  });

  it("command ok:false 按 error.code 抛带码错误", async () => {
    const client = createClient();
    const socket = await connectClient(client);

    const failing = client.command({ type: "app.status" });
    const frame = sentFrame(socket, 1);
    socket.emitMessage({
      apiVersion: LOCAL_CONTROL_API_VERSION,
      type: "response",
      requestId: frame.requestId,
      ok: false,
      error: { code: "permission_denied", message: "denied" },
    });
    await expect(failing).rejects.toBeInstanceOf(PierMobileClientError);
    await expect(failing).rejects.toMatchObject({
      code: "permission_denied",
      message: "denied",
    });
    client.close();
  });

  it("watch 快照整帧回调，服务端超时后携带游标续接", async () => {
    const client = createClient();
    const socket = await connectClient(client);

    const snapshots: ControlSnapshotPayload[] = [];
    const watchPromise = client.watch((payload) => {
      snapshots.push(payload);
    });
    const watchFrame = sentFrame(socket, 1);
    expect(watchFrame.type).toBe("request");
    expect(watchFrame.op).toBe("control.watch");

    socket.emitMessage(
      snapshotEventFrame(watchFrame.requestId, makeSnapshot("boot-1", 7))
    );
    await watchPromise;
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.bootId).toBe("boot-1");
    expect(snapshots[0]?.revision).toBe(7);

    // 服务端 timeoutMs 到点收束 → 客户端带 after 游标重新发起 watch
    socket.emitMessage({
      apiVersion: LOCAL_CONTROL_API_VERSION,
      type: "response",
      requestId: watchFrame.requestId,
      ok: true,
      data: { timedOut: true, lastRevision: 7 },
    });
    const resumeFrame = sentFrame(socket, 2);
    expect(resumeFrame.op).toBe("control.watch");
    expect(resumeFrame.params).toEqual({
      after: { bootId: "boot-1", revision: 7, scope: "global" },
    });
    client.close();
  });

  it("watch 遇非游标错误码时 reject 带码错误", async () => {
    const client = createClient();
    const socket = await connectClient(client);

    const failing = client.watch(() => {});
    const watchFrame = sentFrame(socket, 1);
    socket.emitMessage({
      apiVersion: LOCAL_CONTROL_API_VERSION,
      type: "response",
      requestId: watchFrame.requestId,
      ok: false,
      error: { code: "invalid_command", message: "bad params" },
    });
    await expect(failing).rejects.toMatchObject({ code: "invalid_command" });
    client.close();
  });

  it("断线后指数退避重连：重走握手并以最近游标重新 watch", async () => {
    vi.useFakeTimers();
    const client = createClient();
    const socket = await connectClient(client);

    const snapshots: ControlSnapshotPayload[] = [];
    const watchPromise = client.watch((payload) => {
      snapshots.push(payload);
    });
    socket.emitMessage(
      snapshotEventFrame(
        sentFrame(socket, 1).requestId,
        makeSnapshot("boot-1", 7)
      )
    );
    await watchPromise;

    socket.emitClose();
    expect(client.status).toBe("reconnecting");
    expect(MockWebSocket.instances).toHaveLength(1);

    // 第一次退避 100ms
    await vi.advanceTimersByTimeAsync(99);
    expect(MockWebSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(MockWebSocket.instances).toHaveLength(2);

    // 重连后重走握手
    const second = lastSocket();
    second.emitOpen();
    const helloFrame = sentFrame(second, 0);
    expect(localControlClientHelloSchema.safeParse(helloFrame).success).toBe(
      true
    );
    second.emitMessage(serverHelloFrame(helloFrame.requestId));
    expect(client.status).toBe("connected");

    // watch 自动续接，携带断线前游标
    const watchFrame = sentFrame(second, 1);
    expect(watchFrame.op).toBe("control.watch");
    expect(watchFrame.params).toEqual({
      after: { bootId: "boot-1", revision: 7, scope: "global" },
    });

    // 握手成功后退避重置：再次断线仍是 100ms
    second.emitClose();
    await vi.advanceTimersByTimeAsync(99);
    expect(MockWebSocket.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(MockWebSocket.instances).toHaveLength(3);

    // 重连未握手即失败 → 退避翻倍为 200ms
    lastSocket().emitClose();
    await vi.advanceTimersByTimeAsync(199);
    expect(MockWebSocket.instances).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(MockWebSocket.instances).toHaveLength(4);
    client.close();
  });

  it("退避带加性抖动：delay = base × (1 + ratio × random)", async () => {
    vi.useFakeTimers();
    // random 恒 1、ratio 0.3 → 首次退避 100ms × 1.3 = 130ms
    const client = createClient({ random: () => 1, reconnectJitterRatio: 0.3 });
    const handshake = client.connect(CONNECT_ARGS);
    handshake.catch(() => undefined);
    expect(MockWebSocket.instances).toHaveLength(1);
    lastSocket().emitClose();
    expect(client.status).toBe("reconnecting");

    await vi.advanceTimersByTimeAsync(129);
    expect(MockWebSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(MockWebSocket.instances).toHaveLength(2);
    client.close();
  });

  it("auth_failed 时 connect 以带码错误 reject 且不再重连", async () => {
    vi.useFakeTimers();
    const client = createClient();
    const promise = client.connect(CONNECT_ARGS);
    const socket = lastSocket();
    socket.emitOpen();
    socket.emitMessage({
      apiVersion: LOCAL_CONTROL_API_VERSION,
      type: "server.error",
      code: "auth_failed",
      message: "bad token",
    });
    socket.emitClose();

    await expect(promise).rejects.toMatchObject({ code: "auth_failed" });
    expect(client.status).toBe("closed");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("close() 拒绝挂起请求、关闭 socket 且不再重连", async () => {
    vi.useFakeTimers();
    const client = createClient();
    const socket = await connectClient(client);

    const pending = client.command({ type: "app.status" });
    const expectation = expect(pending).rejects.toThrow("client closed");
    client.close();

    expect(socket.closed).toBe(true);
    expect(client.status).toBe("closed");
    await expectation;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("M1: connecting 态重入 connect 返回同一承诺且不开第二个 socket", async () => {
    const client = createClient();
    const first = client.connect(CONNECT_ARGS);
    const second = client.connect(CONNECT_ARGS);
    expect(second).toBe(first);
    expect(MockWebSocket.instances).toHaveLength(1);

    const socket = lastSocket();
    socket.emitOpen();
    socket.emitMessage(serverHelloFrame(sentFrame(socket, 0).requestId));
    const [h1, h2] = await Promise.all([first, second]);
    expect(h1).toBe(h2);
    expect(client.status).toBe("connected");
    client.close();
  });

  it("M1: reconnecting 态重入 connect 取消退避立即重连，不开第二个 socket", async () => {
    vi.useFakeTimers();
    const client = createClient();
    const socket = await connectClient(client);

    socket.emitClose();
    expect(client.status).toBe("reconnecting");
    const reentry = client.connect(CONNECT_ARGS);
    expect(MockWebSocket.instances).toHaveLength(2);

    const second = lastSocket();
    second.emitOpen();
    second.emitMessage(serverHelloFrame(sentFrame(second, 0).requestId));
    await reentry;
    expect(client.status).toBe("connected");

    // 旧退避定时器已被取消：不再出现第三个 socket
    await vi.advanceTimersByTimeAsync(10_000);
    expect(MockWebSocket.instances).toHaveLength(2);
    client.close();
  });

  it("M2: server.error device_revoked 到达时结算并终止 watch，断连不再重连", async () => {
    vi.useFakeTimers();
    const client = createClient();
    const socket = await connectClient(client);

    const watchPromise = client.watch(() => {});
    socket.emitMessage({
      apiVersion: LOCAL_CONTROL_API_VERSION,
      type: "server.error",
      code: "device_revoked",
      message: "revoked",
    });
    await expect(watchPromise).rejects.toMatchObject({
      code: "device_revoked",
      message: "revoked",
    });

    socket.emitClose();
    expect(client.status).toBe("closed");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("M2: watch 已结算后 server.error 经 onError 终止 watch", async () => {
    const client = createClient();
    const socket = await connectClient(client);

    const errors: Error[] = [];
    const watchPromise = client.watch(
      () => {},
      (error) => errors.push(error)
    );
    const watchFrame = sentFrame(socket, 1);
    socket.emitMessage(
      snapshotEventFrame(watchFrame.requestId, makeSnapshot("boot-1", 1))
    );
    await watchPromise;

    socket.emitMessage({
      apiVersion: LOCAL_CONTROL_API_VERSION,
      type: "server.error",
      code: "auth_failed",
      message: "bad token",
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: "auth_failed" });
    client.close();
  });

  it("M3: watch response ok:false device_revoked 置 fatal，断连不再退避重连", async () => {
    vi.useFakeTimers();
    const client = createClient();
    const socket = await connectClient(client);

    const failing = client.watch(() => {});
    const watchFrame = sentFrame(socket, 1);
    socket.emitMessage({
      apiVersion: LOCAL_CONTROL_API_VERSION,
      type: "response",
      requestId: watchFrame.requestId,
      ok: false,
      error: { code: "device_revoked", message: "revoked" },
    });
    await expect(failing).rejects.toMatchObject({ code: "device_revoked" });

    socket.emitClose();
    expect(client.status).toBe("closed");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(MockWebSocket.instances).toHaveLength(1);
  });
});
