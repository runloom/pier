// @vitest-environment node
/**
 * Task 13 集成冒烟：真 server + 真 pairing service（临时目录 store）+ 桥 +
 * 假 executeCommand 的同网全链。GUI 真机冒烟不在本任务范围（控制器收口），
 * 本文件把链路验证到「端到端可跑」程度：
 * POST /pair 200 → WS hello → server.hello → command 帧往返 → 错误响应 →
 * revokeDevice → 活跃连接收 device_revoked + 断连 → 同 deviceId 并发 hello
 * 按「最新者胜」接受（旧连接先收 device_revoked + close，registry 不回滚）。
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CreateLocalControlSessionArgs } from "@main/adapters/cli/local-control/session.ts";
import {
  createRemoteControlServer,
  type RemoteControlServer,
} from "@main/adapters/remote-control/server.ts";
import {
  attachMobileSession,
  createMobileSessionTracker,
} from "@main/adapters/remote-control/session-bridge.ts";
import type { PierClientRegistry } from "@main/app-core/client-registry.ts";
import { createClientRegistry } from "@main/app-core/client-registry.ts";
import type { ControlSnapshotService } from "@main/services/control-snapshot/service.ts";
import type { PairingService } from "@main/services/pairing/service.ts";
import { createPairingService } from "@main/services/pairing/service.ts";
import { createPairingStore } from "@main/state/pairing-store.ts";
import type { PierCommandEnvelope } from "@shared/contracts/commands.ts";
import type { ControlSnapshotPayload } from "@shared/contracts/local-control/control-snapshot.ts";
import { LOCAL_CONTROL_API_VERSION } from "@shared/contracts/local-control/errors.ts";
import type { LocalControlServerFrame } from "@shared/contracts/local-control/frames.ts";
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";
import WebSocket from "ws";

const tempDirs: string[] = [];
const running: RemoteControlServer[] = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.stop()));
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

type ExecuteCommand = (envelope: PierCommandEnvelope) => Promise<unknown>;

interface TestStack {
  clients: PierClientRegistry;
  executeCalls: PierCommandEnvelope[];
  executeCommand: Mock<ExecuteCommand>;
  pairing: PairingService;
  port: number;
  server: RemoteControlServer;
}

type SessionDepsOverrides = Partial<
  Omit<CreateLocalControlSessionArgs, "authorizer" | "emit">
>;

async function makeStack(
  sessionDepsOverrides: SessionDepsOverrides = {}
): Promise<TestStack> {
  const distDir = await mkdtemp(join(tmpdir(), "pier-e2e-dist-"));
  tempDirs.push(distDir);
  await mkdir(join(distDir, "assets"), { recursive: true });
  await writeFile(join(distDir, "index.html"), "<html>rc-e2e</html>");
  const storeDir = await mkdtemp(join(tmpdir(), "pier-e2e-pairing-"));
  tempDirs.push(storeDir);
  const store = createPairingStore(join(storeDir, "pairing.json"));
  await store.init();
  const pairing = createPairingService({ store });
  const clients = createClientRegistry();
  const executeCalls: PierCommandEnvelope[] = [];
  const executeCommand = vi.fn<ExecuteCommand>(
    async (envelope: PierCommandEnvelope) => {
      executeCalls.push(envelope);
      if (envelope.requestId === "c2") {
        throw new Error("boom");
      }
      return { ok: true, data: { echo: envelope.requestId } };
    }
  );
  const sessionTracker = createMobileSessionTracker();
  const server = createRemoteControlServer({
    addresses: ["127.0.0.1"],
    clients,
    executeCommand,
    onWebSocketConnection: (ws, req: IncomingMessage) => {
      attachMobileSession(ws, {
        clients,
        executeCommand,
        pairing,
        recordFailure: (remoteAddress) => server.recordFailure(remoteAddress),
        recordSuccess: (remoteAddress) => server.recordSuccess(remoteAddress),
        remoteAddress: req.socket.remoteAddress ?? "",
        sessionDeps: { bootId: "boot-e2e", ...sessionDepsOverrides },
        sessionTracker,
      });
    },
    pairing,
    sessionDeps: { bootId: "boot-e2e", ...sessionDepsOverrides },
    spaDistDir: distDir,
  });
  running.push(server);
  const { port } = await server.start();
  return { clients, executeCalls, executeCommand, pairing, port, server };
}

function connect(port: number): Promise<WebSocket> {
  const { promise, resolve, reject } = Promise.withResolvers<WebSocket>();
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  ws.on("open", () => resolve(ws));
  ws.on("error", reject);
  return promise;
}

function nextFrame(ws: WebSocket): Promise<LocalControlServerFrame> {
  const { promise, resolve, reject } =
    Promise.withResolvers<LocalControlServerFrame>();
  ws.once("message", (data: unknown) => {
    resolve(JSON.parse(String(data)) as LocalControlServerFrame);
  });
  ws.once("close", () => reject(new Error("socket closed before frame")));
  ws.once("error", reject);
  return promise;
}

function closed(ws: WebSocket): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  ws.once("close", () => resolve());
  return promise;
}

function send(ws: WebSocket, frame: unknown): void {
  ws.send(JSON.stringify(frame));
}

function helloFrame(deviceId: string, deviceToken: string): unknown {
  return {
    apiVersion: LOCAL_CONTROL_API_VERSION,
    auth: { deviceId, deviceToken, method: "device-token", shell: "web" },
    clientKind: "mobile-paired",
    requestId: "h1",
    type: "client.hello",
  };
}

function commandFrame(requestId: string, command: unknown): unknown {
  return {
    apiVersion: LOCAL_CONTROL_API_VERSION,
    command,
    requestId,
    type: "command",
  };
}

function requestFrame(
  requestId: string,
  op: string,
  params: Record<string, unknown> = {}
): unknown {
  return {
    apiVersion: LOCAL_CONTROL_API_VERSION,
    op,
    params,
    requestId,
    type: "request",
  };
}

async function pairDevice(
  port: number,
  pairing: PairingService
): Promise<{ deviceId: string; deviceToken: string }> {
  const { code } = pairing.beginPairing({ host: "127.0.0.1", port });
  const response = await fetch(`http://127.0.0.1:${port}/pair`, {
    body: JSON.stringify({
      code,
      name: "e2e-device",
      requestedCapabilities: ["git:read"],
      shell: "web",
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    deviceId: string;
    deviceToken: string;
  };
  return { deviceId: body.deviceId, deviceToken: body.deviceToken };
}

describe("remote-control 集成冒烟（真 server + 真 pairing + 桥）", () => {
  it("全链：静态托管 → POST /pair 200 → hello → command 往返 → 错误响应", async () => {
    const stack = await makeStack();
    const base = `http://127.0.0.1:${stack.port}`;

    // 静态 SPA 托管
    const page = await fetch(base);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("rc-e2e");

    const { deviceId, deviceToken } = await pairDevice(
      stack.port,
      stack.pairing
    );

    const ws = await connect(stack.port);
    send(ws, helloFrame(deviceId, deviceToken));
    const hello = await nextFrame(ws);
    expect(hello).toMatchObject({
      apiVersion: LOCAL_CONTROL_API_VERSION,
      principalRef: `mobile:${deviceId}`,
      requestId: "h1",
      type: "server.hello",
    });
    expect(stack.clients.get(`mobile:${deviceId}`)).not.toBeNull();

    // command 帧往返：executeCommand 桥收到信封，回 response
    send(ws, commandFrame("c1", { type: "app.status" }));
    expect(await nextFrame(ws)).toMatchObject({
      data: { echo: "c1" },
      ok: true,
      requestId: "c1",
      type: "response",
    });
    expect(stack.executeCalls[0]).toMatchObject({
      clientId: `mobile:${deviceId}`,
      protocolVersion: 1,
      requestId: "c1",
    });

    // executeCommand 抛错 → internal_error 错误响应
    send(ws, commandFrame("c2", { type: "app.status" }));
    expect(await nextFrame(ws)).toMatchObject({
      error: { code: "internal_error", message: "boom" },
      ok: false,
      requestId: "c2",
      type: "response",
    });

    // 畸形命令载荷 → invalid_command 错误响应（不经 executeCommand）
    const callsBefore = stack.executeCommand.mock.calls.length;
    send(ws, commandFrame("c3", { type: "no.such.command" }));
    expect(await nextFrame(ws)).toMatchObject({
      error: { code: "invalid_command" },
      ok: false,
      requestId: "c3",
      type: "response",
    });
    expect(stack.executeCommand.mock.calls.length).toBe(callsBefore);

    ws.close();
  });

  it("认证失败的 hello 被拒且不计入成功", async () => {
    const stack = await makeStack();
    const { deviceId } = await pairDevice(stack.port, stack.pairing);
    const ws = await connect(stack.port);
    send(ws, helloFrame(deviceId, "wrong-token"));
    const frame = await nextFrame(ws);
    expect(frame).toMatchObject({ type: "server.error" });
    await closed(ws);
    expect(stack.clients.get(`mobile:${deviceId}`)).toBeNull();
    expect(stack.executeCommand).not.toHaveBeenCalled();
  });

  it("最新者胜：同 deviceId 第二条连接顶替第一条，registry 不被旧连接回滚", async () => {
    const stack = await makeStack();
    const { deviceId, deviceToken } = await pairDevice(
      stack.port,
      stack.pairing
    );
    const clientId = `mobile:${deviceId}`;

    const ws1 = await connect(stack.port);
    send(ws1, helloFrame(deviceId, deviceToken));
    const ws1Hello = await nextFrame(ws1);
    expect(ws1Hello).toMatchObject({ type: "server.hello" });

    const ws2 = await connect(stack.port);
    const ws1Closed = closed(ws1);
    const ws2Hello = nextFrame(ws2);
    send(ws2, helloFrame(deviceId, deviceToken));
    // 旧连接先收 device_revoked server.error 再被断开
    expect(await nextFrame(ws1)).toMatchObject({
      code: "device_revoked",
      message: "superseded by a newer session",
      type: "server.error",
    });
    await ws1Closed;
    // 新连接照常收到 server.hello（最新者胜）
    expect(await ws2Hello).toMatchObject({
      principalRef: `mobile:${deviceId}`,
      type: "server.hello",
    });
    // 旧连接 close 不得注销新会话的 registry 注册
    await vi.waitFor(() => {
      expect(stack.clients.get(clientId)).not.toBeNull();
    });
    expect(stack.clients.get(clientId)?.kind).toBe("mobile-paired");

    ws2.close();
  });

  it("revokeDevice：活跃连接收 device_revoked 并断连，registry 注销", async () => {
    const stack = await makeStack();
    const { deviceId, deviceToken } = await pairDevice(
      stack.port,
      stack.pairing
    );
    const ws = await connect(stack.port);
    send(ws, helloFrame(deviceId, deviceToken));
    expect(await nextFrame(ws)).toMatchObject({ type: "server.hello" });

    expect(stack.pairing.revokeDevice(deviceId)).toEqual({ revoked: true });
    const wsClosed = closed(ws);
    expect(await nextFrame(ws)).toMatchObject({
      code: "device_revoked",
      message: "paired device revoked",
      type: "server.error",
    });
    await wsClosed;
    await vi.waitFor(() => {
      expect(stack.clients.get(`mobile:${deviceId}`)).toBeNull();
    });
    expect(stack.pairing.listDevices()).toEqual([]);
  });

  it("control.snapshot：移动端 WS 经共享 sessionDeps 拿到真实快照数据", async () => {
    const snapshotPayload: ControlSnapshotPayload = {
      activity: [],
      agents: [
        {
          agentId: "codex",
          panelId: "panel-1",
          status: "idle",
          windowId: "win-1",
        },
      ],
      bootId: "boot-e2e",
      capturedAt: 1_724_900_000_000,
      notifications: [],
      panels: [],
      revision: 7,
      runtimes: [],
      tasks: [],
      windows: [],
      worktrees: [],
    };
    let snapshotCalls = 0;
    const snapshotService: ControlSnapshotService = {
      currentRevision: () => snapshotPayload.revision,
      snapshot: async () => {
        snapshotCalls += 1;
        return snapshotPayload;
      },
    };
    const stack = await makeStack({ snapshotService });
    const { deviceId, deviceToken } = await pairDevice(
      stack.port,
      stack.pairing
    );
    const ws = await connect(stack.port);
    send(ws, helloFrame(deviceId, deviceToken));
    expect(await nextFrame(ws)).toMatchObject({ type: "server.hello" });

    // v2 request 帧（非 command 通道）：进会话分发 → 共享 snapshotService
    send(ws, requestFrame("s1", "control.snapshot", {}));
    expect(await nextFrame(ws)).toMatchObject({
      data: snapshotPayload,
      ok: true,
      requestId: "s1",
      type: "response",
    });
    expect(snapshotCalls).toBe(1);
    ws.close();
  });

  it("未白名单 op：control.hold 与未知 op 均被移动端 authorizer 拒绝", async () => {
    const stack = await makeStack();
    const { deviceId, deviceToken } = await pairDevice(
      stack.port,
      stack.pairing
    );
    const ws = await connect(stack.port);
    send(ws, helloFrame(deviceId, deviceToken));
    expect(await nextFrame(ws)).toMatchObject({ type: "server.hello" });

    // control.hold 实现存在但不在 MOBILE_ALLOWED → permission_denied
    send(ws, requestFrame("w1", "control.hold", { ms: 10 }));
    expect(await nextFrame(ws)).toMatchObject({
      error: { code: "permission_denied" },
      ok: false,
      requestId: "w1",
      type: "response",
    });
    // 完全未知的 op 同样先过白名单门（而非 unsupported 路由兜底）
    send(ws, requestFrame("w2", "bogus.op"));
    expect(await nextFrame(ws)).toMatchObject({
      error: { code: "permission_denied" },
      ok: false,
      requestId: "w2",
      type: "response",
    });
    ws.close();
  });
});
