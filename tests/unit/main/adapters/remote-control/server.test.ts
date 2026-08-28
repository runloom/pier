// @vitest-environment node
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LAN_PORT_MAX,
  LAN_PORT_MIN,
  listLanIPv4Addresses,
} from "@main/adapters/remote-control/network.ts";
import { createRemoteControlRegistrationOwner } from "@main/adapters/remote-control/registration.ts";
import {
  AUTH_FAILURE_LIMIT,
  AUTH_FAILURE_THROTTLE_MS,
  createAuthFailureThrottle,
  createRemoteControlServer,
  PAIR_BODY_LIMIT_BYTES,
  type RemoteControlServer,
  WS_MAX_PAYLOAD_BYTES,
} from "@main/adapters/remote-control/server.ts";
import { createClientRegistry } from "@main/app-core/client-registry.ts";
import {
  createPairingService,
  PAIRING_CODE_TTL_MS,
  type PairingService,
} from "@main/services/pairing/service.ts";
import { createPairingStore } from "@main/state/pairing-store.ts";
import {
  LOCAL_CONTROL_API_VERSION,
  LOCAL_CONTROL_MAX_FRAME_BYTES,
} from "@shared/contracts/local-control/errors.ts";
import type { PierPairingRequest } from "@shared/contracts/remote.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";

const BASE_TIME = 1_700_000_000_000;

let currentTime = BASE_TIME;
let distDir = "";
const tempDirs: string[] = [];
const running: RemoteControlServer[] = [];

function now(): number {
  return currentTime;
}

beforeEach(async () => {
  currentTime = BASE_TIME;
  distDir = await mkdtemp(join(tmpdir(), "pier-rc-dist-"));
  tempDirs.push(distDir);
  await mkdir(join(distDir, "assets"), { recursive: true });
  await writeFile(join(distDir, "index.html"), "<html>rc</html>");
});

afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.stop()));
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

async function makePairing(): Promise<PairingService> {
  const dir = await mkdtemp(join(tmpdir(), "pier-rc-pairing-"));
  tempDirs.push(dir);
  const store = createPairingStore(join(dir, "pairing.json"));
  await store.init();
  return createPairingService({ now, store });
}

interface TestServer {
  pairing: PairingService;
  server: RemoteControlServer;
}

async function makeServer(
  onWebSocketConnection?: (ws: WebSocket, req: IncomingMessage) => void,
  addresses: string[] = ["127.0.0.1"]
): Promise<TestServer> {
  const pairing = await makePairing();
  const server = createRemoteControlServer({
    addresses,
    clients: createClientRegistry(),
    executeCommand: async () => null,
    onWebSocketConnection: onWebSocketConnection ?? (() => {}),
    pairing,
    sessionDeps: { bootId: "boot-test" },
    spaDistDir: distDir,
  });
  running.push(server);
  return { pairing, server };
}

async function postPair(
  port: number,
  body: unknown
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${port}/pair`, {
    body: typeof body === "string" ? body : JSON.stringify(body),
    method: "POST",
  });
  return {
    json: (await res.json()) as Record<string, unknown>,
    status: res.status,
  };
}

function pairingRequest(
  overrides: Partial<PierPairingRequest> = {}
): PierPairingRequest {
  return { code: "000000", requestedCapabilities: ["git:read"], ...overrides };
}

// 采集期真实枚举：多地址绑定用例依赖本机存在可绑的 LAN 接口。
const lanAddresses = listLanIPv4Addresses();

describe("createRemoteControlServer", () => {
  it("start 绑定区间端口并回报注入地址首枚；state 反映启停；默认不启动", async () => {
    const { server } = await makeServer();
    expect(server.state()).toEqual({ enabled: false, host: null, port: null });
    const { host, port } = await server.start();
    expect(port).toBeGreaterThanOrEqual(LAN_PORT_MIN);
    expect(port).toBeLessThanOrEqual(LAN_PORT_MAX);
    expect(host).toBe("127.0.0.1");
    expect(server.state()).toEqual({ enabled: true, host, port });
    await server.stop();
    expect(server.state()).toEqual({ enabled: false, host: null, port: null });
  });

  it("无可用 LAN 地址时 start 显式失败，QR host 不回退 127.0.0.1", async () => {
    const { server } = await makeServer(undefined, []);
    await expect(server.start()).rejects.toThrow(
      "no LAN IPv4 address available"
    );
    expect(server.state()).toEqual({ enabled: false, host: null, port: null });
  });

  // 隧道接口（utun 等）可绑不可连：以 EADDRINUSE 探测验证逐地址绑定，HTTP 可达性走 127.0.0.1。
  it.skipIf(lanAddresses.length === 0)(
    "每枚 LAN 地址各绑一枚 Server：全部地址被独占绑定且 127.0.0.1 可达",
    async () => {
      const { server } = await makeServer(undefined, lanAddresses);
      const { host, port } = await server.start();
      expect(host).toBe(lanAddresses[0]);
      for (const address of [...new Set([...lanAddresses, "127.0.0.1"])]) {
        const probe = createNetServer();
        const error = await new Promise<NodeJS.ErrnoException | null>(
          (resolve) => {
            probe.once("error", resolve);
            probe.once("listening", () => {
              probe.close(() => resolve(null));
            });
            probe.listen(port, address);
          }
        );
        expect(error?.code).toBe("EADDRINUSE");
      }
      const res = await fetch(`http://127.0.0.1:${port}/`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("<html>rc</html>");
    }
  );

  it("GET 请求走同端口静态托管", async () => {
    const { server } = await makeServer();
    const { port } = await server.start();
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<html>rc</html>");
  });

  it("POST /pair 成功 → 200 返回设备令牌载荷", async () => {
    const { pairing, server } = await makeServer();
    const { port } = await server.start();
    const { code } = pairing.beginPairing({ host: "127.0.0.1", port });
    const { json, status } = await postPair(port, pairingRequest({ code }));
    expect(status).toBe(200);
    expect(json.deviceId).toEqual(expect.any(String));
    expect(json.deviceToken).toEqual(expect.any(String));
    expect(json.grantedCapabilities).toEqual(expect.any(Array));
    expect(json.tokenEpoch).toEqual(expect.any(Number));
  });

  it("POST /pair 配对码过期 → 403 pairing_expired", async () => {
    const { pairing, server } = await makeServer();
    const { port } = await server.start();
    const { code } = pairing.beginPairing({ host: "127.0.0.1", port });
    currentTime = BASE_TIME + PAIRING_CODE_TTL_MS + 1;
    const { json, status } = await postPair(port, pairingRequest({ code }));
    expect(status).toBe(403);
    expect(json.reason).toBe("pairing_expired");
  });

  it("POST /pair 错误配对码 → 403 pairing_invalid，且不消耗有效配对码", async () => {
    const { pairing, server } = await makeServer();
    const { port } = await server.start();
    const { code } = pairing.beginPairing({ host: "127.0.0.1", port });
    const wrong = await postPair(port, pairingRequest());
    expect(wrong.status).toBe(403);
    expect(wrong.json.reason).toBe("pairing_invalid");
    const right = await postPair(port, pairingRequest({ code }));
    expect(right.status).toBe(200);
  });

  it("POST /pair 非法 JSON → 403 pairing_invalid", async () => {
    const { server } = await makeServer();
    const { port } = await server.start();
    const { json, status } = await postPair(port, "{not json");
    expect(status).toBe(403);
    expect(json.reason).toBe("pairing_invalid");
  });
  it("POST /pair body 恰 64 KiB 放行；超 64 KiB → 403 pairing_invalid", async () => {
    const { pairing, server } = await makeServer();
    const { port } = await server.start();
    const { code } = pairing.beginPairing({ host: "127.0.0.1", port });
    const payload = JSON.stringify(pairingRequest({ code }));
    const exact = payload + " ".repeat(PAIR_BODY_LIMIT_BYTES - payload.length);
    const within = await postPair(port, exact);
    expect(within.status).toBe(200);
    const over = await postPair(port, `${exact} `);
    expect(over.status).toBe(403);
    expect(over.json.reason).toBe("pairing_invalid");
  });

  it("WS /ws 升级成功，消息透传到注入回调并可回写", async () => {
    const seen: string[] = [];
    const { server } = await makeServer((ws, req) => {
      expect(req.url).toBe("/ws");
      ws.on("message", (data: Buffer) => {
        seen.push(data.toString());
        ws.send(`echo:${data.toString()}`);
      });
    });
    const { port } = await server.start();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await once(ws, "open");
    ws.send("hello");
    const [data] = (await once(ws, "message")) as [Buffer];
    expect(data.toString()).toBe("echo:hello");
    expect(seen).toEqual(["hello"]);
    ws.close();
    await once(ws, "close");
  });

  it("非 /ws 路径的 upgrade 被拒绝", async () => {
    const { server } = await makeServer();
    const { port } = await server.start();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/nope`);
    const [error] = (await once(ws, "error")) as [Error];
    expect(error.message).toContain("404");
  });

  it("单帧超 LOCAL_CONTROL_MAX_FRAME_BYTES → 先收 frame_too_large JSON 再以 1009 断连", async () => {
    const { server } = await makeServer();
    const { port } = await server.start();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await once(ws, "open");
    ws.send("x".repeat(LOCAL_CONTROL_MAX_FRAME_BYTES + 1));
    const [data] = (await once(ws, "message")) as [Buffer];
    expect(JSON.parse(data.toString())).toEqual({
      apiVersion: LOCAL_CONTROL_API_VERSION,
      code: "frame_too_large",
      message: expect.any(String),
      type: "server.error",
    });
    const [code] = (await once(ws, "close")) as [number];
    expect(code).toBe(1009);
  });

  it("单帧超 ws 硬上限（规格上限 + 1 MiB 余量）→ ws 层直接 1009 断连", async () => {
    const { server } = await makeServer();
    const { port } = await server.start();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await once(ws, "open");
    ws.send("x".repeat(WS_MAX_PAYLOAD_BYTES + 1));
    const [code] = (await once(ws, "close")) as [number];
    expect(code).toBe(1009);
  });

  it("恰在上限的帧正常透传", async () => {
    const { server } = await makeServer((ws) => {
      ws.on("message", (data: Buffer) => ws.send(`len:${data.length}`));
    });
    const { port } = await server.start();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await once(ws, "open");
    ws.send("x".repeat(LOCAL_CONTROL_MAX_FRAME_BYTES));
    const [data] = (await once(ws, "message")) as [Buffer];
    expect(data.toString()).toBe(`len:${LOCAL_CONTROL_MAX_FRAME_BYTES}`);
    ws.close();
    await once(ws, "close");
  });

  it("同 IP 连续 5 次配对失败后 60 秒内连正确码也直接 403", async () => {
    const { pairing, server } = await makeServer();
    const { port } = await server.start();
    const { code } = pairing.beginPairing({ host: "127.0.0.1", port });
    for (let index = 0; index < AUTH_FAILURE_LIMIT; index += 1) {
      const { status } = await postPair(port, pairingRequest());
      expect(status).toBe(403);
    }
    const throttled = await postPair(port, pairingRequest({ code }));
    expect(throttled.status).toBe(403);
    expect(throttled.json.reason).toBe("pairing_invalid");
  });

  it("限速期间同 IP 的 WS 升级也被直接拒绝", async () => {
    const { pairing, server } = await makeServer();
    const { port } = await server.start();
    pairing.beginPairing({ host: "127.0.0.1", port });
    for (let index = 0; index < AUTH_FAILURE_LIMIT; index += 1) {
      await postPair(port, pairingRequest());
    }
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const [error] = (await once(ws, "error")) as [Error];
    expect(error.message).toContain("403");
  });
});

describe("createAuthFailureThrottle", () => {
  it("第 5 次连续失败进入 60 秒限速，窗口过后自动解除", () => {
    let t = 0;
    const throttle = createAuthFailureThrottle(() => t);
    for (let index = 0; index < AUTH_FAILURE_LIMIT - 1; index += 1) {
      throttle.recordFailure("10.0.0.1");
      expect(throttle.isThrottled("10.0.0.1")).toBe(false);
    }
    throttle.recordFailure("10.0.0.1");
    expect(throttle.isThrottled("10.0.0.1")).toBe(true);
    t += AUTH_FAILURE_THROTTLE_MS - 1;
    expect(throttle.isThrottled("10.0.0.1")).toBe(true);
    t += 1;
    expect(throttle.isThrottled("10.0.0.1")).toBe(false);
  });

  it("限速按 IP 隔离", () => {
    const throttle = createAuthFailureThrottle(() => 0);
    for (let index = 0; index < AUTH_FAILURE_LIMIT; index += 1) {
      throttle.recordFailure("10.0.0.1");
    }
    expect(throttle.isThrottled("10.0.0.1")).toBe(true);
    expect(throttle.isThrottled("10.0.0.2")).toBe(false);
  });

  it("recordSuccess 清零连续失败计数", () => {
    const throttle = createAuthFailureThrottle(() => 0);
    for (let index = 0; index < AUTH_FAILURE_LIMIT - 1; index += 1) {
      throttle.recordFailure("10.0.0.1");
    }
    throttle.recordSuccess("10.0.0.1");
    for (let index = 0; index < AUTH_FAILURE_LIMIT - 1; index += 1) {
      throttle.recordFailure("10.0.0.1");
    }
    expect(throttle.isThrottled("10.0.0.1")).toBe(false);
  });
});

describe("createRemoteControlRegistrationOwner", () => {
  function fakeServer(overrides: {
    start?: () => Promise<{ host: string; port: number }>;
    stop?: () => Promise<void>;
  }): RemoteControlServer {
    return {
      isThrottled: () => false,
      recordFailure: () => {},
      recordSuccess: () => {},
      start:
        overrides.start ??
        (async () => ({ host: "192.168.1.2", port: 47_000 })),
      state: () => ({ enabled: false, host: null, port: null }),
      stop: overrides.stop ?? (async () => {}),
    };
  }

  it("默认不启动；start 幂等，stop 幂等", async () => {
    const start = vi.fn(async () => ({ host: "192.168.1.2", port: 47_000 }));
    const stop = vi.fn(async () => {});
    const owner = createRemoteControlRegistrationOwner({
      logError: () => {},
      server: fakeServer({ start, stop }),
    });
    expect(owner.state()).toBe("stopped");
    await owner.start();
    await owner.start();
    expect(start).toHaveBeenCalledTimes(1);
    expect(owner.state()).toBe("running");
    await owner.stop();
    await owner.stop();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(owner.state()).toBe("stopped");
  });

  it("stop 等待进行中的 start 收口后再停", async () => {
    const gate = Promise.withResolvers<{ host: string; port: number }>();
    const start = vi.fn(() => gate.promise);
    const stop = vi.fn(async () => {});
    const owner = createRemoteControlRegistrationOwner({
      logError: () => {},
      server: fakeServer({ start, stop }),
    });
    const startPromise = owner.start();
    expect(owner.state()).toBe("starting");
    const stopPromise = owner.stop();
    expect(owner.state()).toBe("stopping");
    await Promise.resolve();
    expect(stop).not.toHaveBeenCalled();
    gate.resolve({ host: "192.168.1.2", port: 47_000 });
    await Promise.all([startPromise, stopPromise]);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(owner.state()).toBe("stopped");
  });

  it("start 失败写日志并回到 stopped，可重试", async () => {
    const failure = new Error("EADDRINUSE");
    const start = vi
      .fn<() => Promise<{ host: string; port: number }>>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValue({ host: "192.168.1.2", port: 47_000 });
    const errors: unknown[] = [];
    const owner = createRemoteControlRegistrationOwner({
      logError: (error) => errors.push(error),
      server: fakeServer({ start }),
    });
    await owner.start();
    expect(errors).toEqual([failure]);
    expect(owner.state()).toBe("stopped");
    await owner.start();
    expect(owner.state()).toBe("running");
  });
});
