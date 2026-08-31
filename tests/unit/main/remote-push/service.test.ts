// @vitest-environment node
/**
 * Web Push 发送器（M2 Task 8，规格 §12）：VAPID 生命周期、句柄登记/清理、
 * 候选投影、冷却节流、410 失效清册。transport / keygen 全注入，不触真网。
 */
import {
  createRemotePushService,
  type PushTransport,
} from "@main/services/remote-push/service.ts";
import type {
  PairingState,
  PairingStore,
  StoredPairedDevice,
} from "@main/state/pairing-store.ts";
import { makeAgentRef } from "@shared/contracts/agent/runtime-index.ts";
import { describe, expect, it, vi } from "vitest";
import { makeFakeSecrets } from "../pairing/fake-secrets.ts";

function device(deviceId: string): StoredPairedDevice {
  return {
    capabilities: ["app:read"],
    createdAt: 0,
    deviceId,
    lastSeenAt: 0,
    name: deviceId,
    shell: "web",
    tokenEpoch: 0,
    tokenHash: "hash",
  };
}

function memoryStore(devices: StoredPairedDevice[]): PairingStore {
  let state: PairingState = {
    devices,
    instanceSecret: "s",
    pendingPairing: null,
  };
  return {
    clear: async () => undefined,
    flush: async () => undefined,
    get: () => state,
    init: () => Promise.resolve(state),
    mutate(fn) {
      state = fn(state);
      return state;
    },
  };
}

const SUBSCRIPTION = {
  endpoint: "https://web.push.apple.com/sub/1",
  keys: { auth: "auth", p256dh: "p256dh" },
};

function makeService(args: {
  devices?: StoredPairedDevice[];
  transport?: PushTransport;
  now?: () => number;
}) {
  const store = memoryStore(args.devices ?? [device("d1")]);
  const secrets = makeFakeSecrets();
  const transport: PushTransport =
    args.transport ?? vi.fn<PushTransport>(async () => undefined);
  const generateKeys = vi.fn(async () => ({
    privateKey: "vapid-private",
    publicKey: "vapid-public",
  }));
  const service = createRemotePushService({
    generateKeys,
    secrets,
    store,
    transport,
    ...(args.now ? { now: args.now } : {}),
  });
  return { generateKeys, secrets, service, store, transport };
}

const NOTIFICATION = {
  // 生产格式：makeAgentRef(windowId, panelId)（\0 分隔；解析只在 main）。
  agentRef: makeAgentRef("11", "p1"),
  kind: "agent.attention",
  severity: "warning",
  title: "需要你处理",
} as const;

describe("VAPID 密钥生命周期", () => {
  it("首次生成并持久化；二次 ensure 复用不再生成", async () => {
    const { generateKeys, secrets, service } = makeService({});
    await service.ensureReady();
    expect(service.publicKey()).toBe("vapid-public");
    expect(await secrets.get("remote.push.vapid.private")).toBe(
      "vapid-private"
    );
    await service.ensureReady();
    expect(generateKeys).toHaveBeenCalledTimes(1);
  });
});

describe("句柄登记与候选投影", () => {
  it("register 覆盖旧句柄；candidates 只含已配对且持句柄设备", () => {
    const { service } = makeService({
      devices: [device("d1"), device("d2")],
    });
    service.registerHandle("d1", SUBSCRIPTION);
    service.registerHandle("ghost", SUBSCRIPTION); // 未配对：登记但不出现在候选
    expect(service.handles()).toHaveLength(2);

    const candidates = service.candidates((deviceId) => deviceId === "d1");
    expect(candidates).toEqual([{ deviceId: "d1", hasLiveSession: true }]);

    service.unregisterHandle("d1");
    expect(service.candidates(() => false)).toEqual([]);
  });
});

describe("发送、冷却与失效清理", () => {
  it("发送携带 VAPID 与载荷；同 (kind, agentRef) 窗口内节流", async () => {
    let ts = 1_000_000;
    const transport = vi.fn<PushTransport>(async () => undefined);
    const { service } = makeService({ now: () => ts, transport });
    service.registerHandle("d1", SUBSCRIPTION);

    await service.send(NOTIFICATION, ["d1"]);
    expect(transport).toHaveBeenCalledTimes(1);
    const call = transport.mock.calls[0];
    if (!call) {
      throw new Error("expected transport to have been called");
    }
    const [subscription, payloadJson, vapid] = call;
    expect(subscription).toEqual(SUBSCRIPTION);
    // 会话深链（闭环第 6 条）：只带 panelId（面板寻址，窗口概念不出宿主）。
    expect(JSON.parse(payloadJson)).toMatchObject({
      path: "/session?panel=p1",
      title: "需要你处理",
    });
    expect((vapid as { publicKey: string }).publicKey).toBe("vapid-public");
    expect((vapid as { subject: string }).subject).toBe("https://pier.codes");

    await service.send(NOTIFICATION, ["d1"]);
    expect(transport).toHaveBeenCalledTimes(1); // 冷却内不重发

    ts += 200_000;
    await service.send(NOTIFICATION, ["d1"]);
    expect(transport).toHaveBeenCalledTimes(2); // 窗口过后放行
  });

  it("不同 agentRef 冷却互不吞没", async () => {
    const transport = vi.fn<PushTransport>(async () => undefined);
    const { service } = makeService({ transport });
    service.registerHandle("d1", SUBSCRIPTION);
    await service.send(NOTIFICATION, ["d1"]);
    await service.send({ ...NOTIFICATION, agentRef: "11:p2" }, ["d1"]);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("410 Gone 即删句柄；其余错误只告警不清册", async () => {
    const gone = Object.assign(new Error("gone"), { statusCode: 410 });
    const flaky = new Error("timeout");
    const transport = vi
      .fn(async () => undefined)
      .mockRejectedValueOnce(gone)
      .mockRejectedValueOnce(flaky);
    const { service } = makeService({
      devices: [device("d1"), device("d2")],
      transport,
    });
    service.registerHandle("d1", SUBSCRIPTION);
    service.registerHandle("d2", SUBSCRIPTION);

    await service.send(NOTIFICATION, ["d1", "d2"]);
    const remaining = service.handles().map((handle) => handle.deviceId);
    expect(remaining).toEqual(["d2"]); // d1 被 410 清册，d2 保留
  });

  it("无句柄设备静默跳过；空目标零副作用", async () => {
    const transport = vi.fn(async () => undefined);
    const { service } = makeService({ transport });
    await service.send(NOTIFICATION, []);
    await service.send(NOTIFICATION, ["no-handle"]);
    expect(transport).not.toHaveBeenCalled();
  });
});
