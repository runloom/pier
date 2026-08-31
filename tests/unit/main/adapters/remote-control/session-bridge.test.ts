// @vitest-environment node
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AttachMobileSessionContext,
  attachMobileSession,
  type WebSocketLike,
} from "@main/adapters/remote-control/session-bridge.ts";
import {
  createClientRegistry,
  type PierClientRegistry,
} from "@main/app-core/client-registry.ts";
import {
  createPairingService,
  type PairingService,
} from "@main/services/pairing/service.ts";
import {
  createPairingStore,
  type PairingStore,
} from "@main/state/pairing-store.ts";
import { LOCAL_CONTROL_API_VERSION } from "@shared/contracts/local-control/errors.ts";
import type { PierPairingRequest } from "@shared/contracts/remote.ts";
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";

const BASE_TIME = 1_700_000_000_000;
const REMOTE_ADDRESS = "192.168.1.50";

let currentTime = BASE_TIME;
const tempDirs: string[] = [];

function now(): number {
  return currentTime;
}

afterEach(async () => {
  currentTime = BASE_TIME;
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

type SentFrame = Record<string, unknown> & { type?: string };

/** 同步触发 close 事件的假 WS：断言不依赖事件循环时序。 */
class FakeWebSocket extends EventEmitter implements WebSocketLike {
  sent: string[] = [];
  closeCalls = 0;
  closed = false;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closeCalls += 1;
    if (!this.closed) {
      this.closed = true;
      this.emit("close");
    }
  }

  receive(line: string): void {
    this.emit("message", Buffer.from(line, "utf8"));
  }

  frames(): SentFrame[] {
    return this.sent.map((line) => JSON.parse(line) as SentFrame);
  }

  lastFrame(): SentFrame {
    const frame = this.frames().at(-1);
    if (!frame) {
      throw new Error("no frame sent");
    }
    return frame;
  }
}

interface PairedDevice {
  deviceId: string;
  deviceToken: string;
  tokenEpoch: number;
}

interface Fixture {
  clients: PierClientRegistry;
  device: PairedDevice;
  executeCommand: Mock;
  pairing: PairingService;
  recordFailure: Mock;
  recordSuccess: Mock;
  store: PairingStore;
  ws: FakeWebSocket;
}

async function makePairing(): Promise<{
  pairing: PairingService;
  store: PairingStore;
}> {
  const dir = await mkdtemp(join(tmpdir(), "pier-rc-bridge-"));
  tempDirs.push(dir);
  const store = createPairingStore(join(dir, "pairing.json"));
  await store.init();
  return { pairing: createPairingService({ now, store }), store };
}

async function pairDevice(pairing: PairingService): Promise<PairedDevice> {
  const { code } = pairing.beginPairing({ host: "192.168.1.2", port: 47_000 });
  const request: PierPairingRequest = {
    code,
    requestedCapabilities: ["git:read"],
  };
  const redeemed = await pairing.redeemPairingCode(request);
  if (!redeemed.ok) {
    throw new Error("redeem failed");
  }
  return {
    deviceId: redeemed.deviceId,
    deviceToken: redeemed.deviceToken,
    tokenEpoch: redeemed.tokenEpoch,
  };
}

async function makeFixture(
  overrides: {
    executeCommand?: Mock;
    sessionDeps?: AttachMobileSessionContext["sessionDeps"];
  } = {}
): Promise<Fixture> {
  const { pairing, store } = await makePairing();
  const device = await pairDevice(pairing);
  const clients = createClientRegistry(now);
  const executeCommand =
    overrides.executeCommand ??
    vi.fn(async () => ({ ok: true, requestId: "cmd-1", data: { up: true } }));
  const recordFailure = vi.fn();
  const recordSuccess = vi.fn();
  const ws = new FakeWebSocket();
  attachMobileSession(ws, {
    clients,
    executeCommand,
    pairing,
    recordFailure,
    recordSuccess,
    remoteAddress: REMOTE_ADDRESS,
    sessionDeps: overrides.sessionDeps ?? { bootId: "boot-test" },
  });
  return {
    clients,
    device,
    executeCommand,
    pairing,
    recordFailure,
    recordSuccess,
    store,
    ws,
  };
}

function helloLine(
  device: PairedDevice,
  overrides: Record<string, unknown> = {}
): string {
  return JSON.stringify({
    apiVersion: LOCAL_CONTROL_API_VERSION,
    type: "client.hello",
    requestId: "hello-1",
    clientKind: "mobile-paired",
    auth: {
      method: "device-token",
      deviceId: device.deviceId,
      deviceToken: device.deviceToken,
      shell: "web",
    },
    ...overrides,
  });
}

function commandLine(requestId: string, command: unknown): string {
  return JSON.stringify({
    apiVersion: LOCAL_CONTROL_API_VERSION,
    type: "command",
    requestId,
    command,
  });
}

function requestLine(requestId: string, op: string): string {
  return JSON.stringify({
    apiVersion: LOCAL_CONTROL_API_VERSION,
    type: "request",
    requestId,
    op,
    params: {},
  });
}

function establishSession(fx: Fixture): void {
  fx.ws.receive(helloLine(fx.device));
}

/** 将设备 tokenEpoch +1，模拟吊销外的 epoch 失效路径。 */
function bumpEpoch(fx: Fixture): void {
  fx.store.mutate((state) => ({
    ...state,
    devices: state.devices.map((device) =>
      device.deviceId === fx.device.deviceId
        ? { ...device, tokenEpoch: device.tokenEpoch + 1 }
        : device
    ),
  }));
}

function lastSeenAt(fx: Fixture): number | undefined {
  return fx.pairing
    .listDevices()
    .find((device) => device.deviceId === fx.device.deviceId)?.lastSeenAt;
}

async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe("attachMobileSession / hello", () => {
  it("认证通过 → server.hello + 注册 mobile 客户端 + touchLastSeen + recordSuccess", async () => {
    const fx = await makeFixture();
    currentTime += 1000;
    establishSession(fx);

    expect(fx.ws.lastFrame()).toMatchObject({
      apiVersion: LOCAL_CONTROL_API_VERSION,
      type: "server.hello",
      requestId: "hello-1",
      bootId: "boot-test",
      principalRef: `mobile:${fx.device.deviceId}`,
    });
    const client = fx.clients.get(`mobile:${fx.device.deviceId}`);
    expect(client).toMatchObject({
      id: `mobile:${fx.device.deviceId}`,
      kind: "mobile-paired",
      capabilities: ["git:read"],
    });
    expect(lastSeenAt(fx)).toBe(BASE_TIME + 1000);
    expect(fx.recordSuccess).toHaveBeenCalledWith(REMOTE_ADDRESS);
    expect(fx.recordFailure).not.toHaveBeenCalled();
  });

  it("认证失败 → auth_failed + recordFailure(remoteAddress) + close，不注册客户端", async () => {
    const fx = await makeFixture();
    fx.ws.receive(
      helloLine({ ...fx.device, deviceToken: "wrong-token-0000000000000000" })
    );

    expect(fx.ws.lastFrame()).toMatchObject({
      type: "server.error",
      code: "auth_failed",
    });
    expect(fx.ws.closed).toBe(true);
    expect(fx.recordFailure).toHaveBeenCalledWith(REMOTE_ADDRESS);
    expect(fx.recordSuccess).not.toHaveBeenCalled();
    expect(fx.clients.list()).toEqual([]);
  });

  it.each([
    [
      "cli-human hello",
      JSON.stringify({
        apiVersion: LOCAL_CONTROL_API_VERSION,
        type: "client.hello",
        requestId: "hello-1",
        clientKind: "cli-human",
        auth: { method: "none" },
      }),
    ],
    ["非 hello 帧", requestLine("r-1", "agents.list")],
    ["非 JSON", "not-json{{{"],
  ])("首帧为 %s → protocol_unsupported + close（不计认证失败）", async (_label, line) => {
    const fx = await makeFixture();
    fx.ws.receive(line);

    expect(fx.ws.lastFrame()).toMatchObject({
      type: "server.error",
      code: "protocol_unsupported",
    });
    expect(fx.ws.closed).toBe(true);
    expect(fx.recordFailure).not.toHaveBeenCalled();
  });
});

describe("attachMobileSession / command 通道", () => {
  it("command 帧 → epoch 核对后 executeCommand 往返，结果包成 response 并 touchLastSeen", async () => {
    const fx = await makeFixture();
    establishSession(fx);
    currentTime += 2000;
    fx.ws.receive(commandLine("cmd-1", { type: "app.status" }));
    await flushMicrotasks();

    expect(fx.executeCommand).toHaveBeenCalledWith({
      protocolVersion: 1,
      requestId: "cmd-1",
      clientId: `mobile:${fx.device.deviceId}`,
      command: { type: "app.status" },
    });
    expect(fx.ws.lastFrame()).toEqual({
      apiVersion: LOCAL_CONTROL_API_VERSION,
      type: "response",
      requestId: "cmd-1",
      ok: true,
      data: { up: true },
    });
    expect(lastSeenAt(fx)).toBe(BASE_TIME + 2000);
  });

  it("executeCommand 失败结果 → ok:false response，v2 内错误码透传", async () => {
    const executeCommand = vi.fn(async () => ({
      ok: false,
      requestId: "cmd-1",
      error: { code: "permission_denied", message: "denied by policy" },
    }));
    const fx = await makeFixture({ executeCommand });
    establishSession(fx);
    fx.ws.receive(commandLine("cmd-1", { type: "app.status" }));
    await flushMicrotasks();

    expect(fx.ws.lastFrame()).toEqual({
      apiVersion: LOCAL_CONTROL_API_VERSION,
      type: "response",
      requestId: "cmd-1",
      ok: false,
      error: { code: "permission_denied", message: "denied by policy" },
    });
  });

  it("executeCommand 返回 v2 外错误码 → 折叠为 internal_error", async () => {
    const executeCommand = vi.fn(async () => ({
      ok: false,
      requestId: "cmd-1",
      error: { code: "cancelled", message: "aborted" },
    }));
    const fx = await makeFixture({ executeCommand });
    establishSession(fx);
    fx.ws.receive(commandLine("cmd-1", { type: "app.status" }));
    await flushMicrotasks();

    expect(fx.ws.lastFrame()).toMatchObject({
      type: "response",
      requestId: "cmd-1",
      ok: false,
      error: { code: "internal_error", message: "aborted" },
    });
  });

  it("epoch 失配 → device_revoked response + 断连，executeCommand 不调用", async () => {
    const fx = await makeFixture();
    establishSession(fx);
    bumpEpoch(fx);
    fx.ws.receive(commandLine("cmd-1", { type: "app.status" }));

    expect(fx.ws.lastFrame()).toEqual({
      apiVersion: LOCAL_CONTROL_API_VERSION,
      type: "response",
      requestId: "cmd-1",
      ok: false,
      error: {
        code: "device_revoked",
        message: "paired device revoked or token epoch stale",
      },
    });
    expect(fx.ws.closed).toBe(true);
    expect(fx.executeCommand).not.toHaveBeenCalled();
  });

  it("command 载荷非法 → invalid_command，executeCommand 不调用", async () => {
    const fx = await makeFixture();
    establishSession(fx);
    fx.ws.receive(commandLine("cmd-1", { type: "no.such.command" }));

    expect(fx.ws.lastFrame()).toMatchObject({
      type: "response",
      requestId: "cmd-1",
      ok: false,
      error: { code: "invalid_command" },
    });
    expect(fx.executeCommand).not.toHaveBeenCalled();
  });
});

describe("attachMobileSession / 吊销与清理", () => {
  it("吊销本设备 → 立即 device_revoked + 断连 + 注销客户端", async () => {
    const fx = await makeFixture();
    establishSession(fx);
    fx.pairing.revokeDevice(fx.device.deviceId);

    expect(fx.ws.lastFrame()).toMatchObject({
      type: "server.error",
      code: "device_revoked",
    });
    expect(fx.ws.closed).toBe(true);
    expect(fx.clients.get(`mobile:${fx.device.deviceId}`)).toBeNull();

    // close 后会话已 dispose：后续帧不再产生任何输出。
    const sentBefore = fx.ws.sent.length;
    fx.ws.receive(commandLine("cmd-9", { type: "app.status" }));
    expect(fx.ws.sent.length).toBe(sentBefore);
  });

  it("吊销其它设备不影响本会话", async () => {
    const fx = await makeFixture();
    const other = await pairDevice(fx.pairing);
    establishSession(fx);
    const sentBefore = fx.ws.sent.length;

    fx.pairing.revokeDevice(other.deviceId);

    expect(fx.ws.closed).toBe(false);
    expect(fx.ws.sent.length).toBe(sentBefore);
    expect(fx.clients.get(`mobile:${fx.device.deviceId}`)).not.toBeNull();
  });

  it("对端 close → unregister + session dispose", async () => {
    const fx = await makeFixture();
    establishSession(fx);
    fx.ws.emit("close");

    expect(fx.clients.get(`mobile:${fx.device.deviceId}`)).toBeNull();
    const sentBefore = fx.ws.sent.length;
    fx.ws.receive(requestLine("w-1", "agents.list"));
    expect(fx.ws.sent.length).toBe(sentBefore);
  });

  it("未建会话前 close 不报错、不注销", async () => {
    const fx = await makeFixture();
    expect(() => fx.ws.emit("close")).not.toThrow();
    expect(fx.clients.list()).toEqual([]);
  });
});

describe("attachMobileSession / 会话帧透传", () => {
  it("watch 等 v2 帧原文透传 session.handleLine（未接 snapshotService → unsupported）", async () => {
    const fx = await makeFixture();
    establishSession(fx);
    fx.ws.receive(requestLine("w-1", "control.watch"));

    expect(fx.ws.lastFrame()).toMatchObject({
      type: "response",
      requestId: "w-1",
      ok: false,
      error: { code: "unsupported", message: "control.watch not wired" },
    });
  });

  it("epoch 失配后 watch 请求被 authorizer epoch 门拒为 device_revoked", async () => {
    const fx = await makeFixture();
    establishSession(fx);
    bumpEpoch(fx);
    fx.ws.receive(requestLine("w-1", "control.watch"));

    expect(fx.ws.lastFrame()).toMatchObject({
      type: "response",
      requestId: "w-1",
      ok: false,
      error: { code: "device_revoked" },
    });
  });
});
