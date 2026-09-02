/**
 * remoteAccess.*（M1 宿主远程访问管理命令面）：
 * 五条命令正/负向、getState 脱敏（响应体不得含 tokenHash / 令牌原文）、
 * pendingPairing QR 视图（签发可见 / 过期或取消即 null）。
 * 授权（kind 门 + 能力门）用例在 permissions.test.ts。
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RemoteControlRegistrationOwner } from "@main/adapters/remote-control/registration.ts";
import type { RemoteControlServer } from "@main/adapters/remote-control/server.ts";
import type { PierCoreServices } from "@main/app-core/command-router-services.ts";
import { executeRemoteAccessCommand } from "@main/app-core/commands/remote-access.ts";
import {
  createPairingService,
  PAIRING_CODE_TTL_MS,
  type PairingService,
} from "@main/services/pairing/service.ts";
import { createPairingStore } from "@main/state/pairing-store.ts";
import type {
  PierCommand,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import type { PierPairingRequest } from "@shared/contracts/remote.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const HOST = "192.168.1.2";
const PORT = 47_000;

let nowMs = 1_800_000_000_000;
const tempDirs: string[] = [];

async function makePairing(): Promise<PairingService> {
  const dir = await mkdtemp(join(tmpdir(), "pier-ra-cmd-"));
  tempDirs.push(dir);
  const store = createPairingStore(join(dir, "pairing.json"));
  await store.init();
  return createPairingService({ now: () => nowMs, store });
}

interface RemoteControlDouble {
  owner: RemoteControlRegistrationOwner;
  server: RemoteControlServer;
}

/** registration-owner + server 测试桩：owner 启停驱动 server 状态翻转。 */
function makeRemoteControl(enabled = false): RemoteControlDouble {
  const state: { enabled: boolean; host: string | null; port: number | null } =
    {
      enabled,
      host: enabled ? HOST : null,
      port: enabled ? PORT : null,
    };
  const server: RemoteControlServer = {
    isThrottled: () => false,
    recordFailure: () => {},
    recordSuccess: () => {},
    start: vi.fn(async () => {
      state.enabled = true;
      state.host = HOST;
      state.port = PORT;
      return { host: HOST, port: PORT };
    }),
    state: () => ({ ...state }),
    stop: vi.fn(async () => {
      state.enabled = false;
      state.host = null;
      state.port = null;
    }),
  };
  const owner: RemoteControlRegistrationOwner = {
    start: vi.fn(async () => {
      await server.start();
    }),
    state: () => (state.enabled ? "running" : "stopped"),
    stop: vi.fn(() => server.stop()),
  };
  return { owner, server };
}

function services(args: {
  pairing?: PairingService;
  remoteControl?: RemoteControlDouble;
}): PierCoreServices {
  const { pairing, remoteControl } = args;
  return {
    ...(pairing ? { pairing } : {}),
    ...(remoteControl ? { remoteControl } : {}),
  } as never;
}

function okData(result: PierCommandResult | null): Record<string, unknown> {
  if (!result?.ok) {
    throw new Error(`expected ok result, got: ${JSON.stringify(result)}`);
  }
  return result.data as Record<string, unknown>;
}

function redeemRequest(code: string): PierPairingRequest {
  return {
    code,
    name: "Pixel 8",
    requestedCapabilities: ["app:read", "terminal:read"],
    shell: "web",
  };
}

beforeEach(() => {
  nowMs = 1_800_000_000_000;
});

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

describe("remoteAccess.* executor 分发", () => {
  it("非本族命令 → null（交回 executor 链）", async () => {
    const result = await executeRemoteAccessCommand(
      "r0",
      { type: "notifications.list" },
      services({})
    );
    expect(result).toBeNull();
  });

  it("五条命令在服务未装配时一律 platform_unavailable", async () => {
    const commands: PierCommand[] = [
      { type: "remoteAccess.getState" },
      { type: "remoteAccess.setEnabled", enabled: true },
      { type: "remoteAccess.beginPairing" },
      { type: "remoteAccess.cancelPairing" },
      { type: "remoteAccess.revokeDevice", deviceId: "dev-1" },
    ];
    for (const [index, command] of commands.entries()) {
      const result = await executeRemoteAccessCommand(
        `r-missing-${index}`,
        command,
        services({})
      );
      expect(result).toMatchObject({
        error: { code: "platform_unavailable" },
        ok: false,
      });
    }
  });

  it("只有 remoteControl 没有 pairing 同样 platform_unavailable", async () => {
    const result = await executeRemoteAccessCommand(
      "r-partial",
      { type: "remoteAccess.getState" },
      services({ remoteControl: makeRemoteControl(true) })
    );
    expect(result).toMatchObject({
      error: { code: "platform_unavailable" },
      ok: false,
    });
  });
});

describe("remoteAccess.setEnabled 持久化", () => {
  it("开/关都写盘（重启恢复的唯一来源）", async () => {
    const pairing = await makePairing();
    const deps = services({ pairing, remoteControl: makeRemoteControl(false) });
    expect(pairing.remoteAccessEnabled()).toBe(false);

    await executeRemoteAccessCommand(
      "rp1",
      { enabled: true, type: "remoteAccess.setEnabled" },
      deps
    );
    expect(pairing.remoteAccessEnabled()).toBe(true);

    await executeRemoteAccessCommand(
      "rp2",
      { enabled: false, type: "remoteAccess.setEnabled" },
      deps
    );
    expect(pairing.remoteAccessEnabled()).toBe(false);
  });
});

describe("remoteAccess.getState", () => {
  it("未启用：enabled/host/port 镜像 server.state()，空设备与空待决配对", async () => {
    const pairing = await makePairing();
    const result = await executeRemoteAccessCommand(
      "r1",
      { type: "remoteAccess.getState" },
      services({ pairing, remoteControl: makeRemoteControl(false) })
    );
    expect(result).toEqual({
      data: {
        boundaryNote: true,
        devices: [],
        enabled: false,
        host: null,
        pendingPairing: null,
        port: null,
        remote: { configured: false, connectionState: "stopped" },
      },
      ok: true,
      requestId: "r1",
    });
  });

  it("已配对设备列表脱敏：无 tokenHash 字段、无令牌原文", async () => {
    const pairing = await makePairing();
    const issued = pairing.beginPairing({ host: HOST, port: PORT });
    const redeemed = await pairing.redeemPairingCode(
      redeemRequest(issued.code)
    );
    if (!redeemed.ok) {
      throw new Error("redeem failed");
    }
    // 底层存储确实持有 tokenHash——脱敏是命令面行为而非服务缺省。
    expect(pairing.listDevices()[0]?.tokenHash).toEqual(expect.any(String));

    const result = await executeRemoteAccessCommand(
      "r2",
      { type: "remoteAccess.getState" },
      services({ pairing, remoteControl: makeRemoteControl(true) })
    );
    const data = okData(result);
    const devices = data.devices as Record<string, unknown>[];
    expect(devices).toHaveLength(1);
    expect(Object.keys(devices[0] ?? {}).sort()).toEqual([
      "capabilities",
      "createdAt",
      "deviceId",
      "lastSeenAt",
      "name",
      "shell",
      "tokenEpoch",
    ]);
    expect(devices[0]).toMatchObject({
      deviceId: redeemed.deviceId,
      name: "Pixel 8",
      shell: "web",
      tokenEpoch: 0,
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("tokenHash");
    expect(serialized).not.toContain(redeemed.deviceToken);
  });

  it("签发配对码后 pendingPairing 携带 qrPayload 与 expiresAt", async () => {
    const pairing = await makePairing();
    const deps = services({ pairing, remoteControl: makeRemoteControl(true) });
    const begin = await executeRemoteAccessCommand(
      "r3",
      { type: "remoteAccess.beginPairing" },
      deps
    );
    const beginData = okData(begin);
    const state = await executeRemoteAccessCommand(
      "r4",
      { type: "remoteAccess.getState" },
      deps
    );
    expect(okData(state).pendingPairing).toEqual({
      expiresAt: beginData.expiresAt,
      qrPayload: beginData.qrPayload,
    });
  });

  it("配对码过期后 pendingPairing 回落 null", async () => {
    const pairing = await makePairing();
    const deps = services({ pairing, remoteControl: makeRemoteControl(true) });
    await executeRemoteAccessCommand(
      "r5",
      { type: "remoteAccess.beginPairing" },
      deps
    );
    nowMs += PAIRING_CODE_TTL_MS;
    const state = await executeRemoteAccessCommand(
      "r6",
      { type: "remoteAccess.getState" },
      deps
    );
    expect(okData(state).pendingPairing).toBeNull();
  });
});

describe("remoteAccess.setEnabled", () => {
  it("enabled:true → registration-owner start，返回最新 enabled", async () => {
    const pairing = await makePairing();
    const remoteControl = makeRemoteControl(false);
    const result = await executeRemoteAccessCommand(
      "r7",
      { type: "remoteAccess.setEnabled", enabled: true },
      services({ pairing, remoteControl })
    );
    expect(result).toEqual({
      data: { enabled: true },
      ok: true,
      requestId: "r7",
    });
    expect(remoteControl.owner.start).toHaveBeenCalledTimes(1);
    expect(remoteControl.owner.stop).not.toHaveBeenCalled();
  });

  it("enabled:false → registration-owner stop，返回最新 enabled", async () => {
    const pairing = await makePairing();
    const remoteControl = makeRemoteControl(true);
    const result = await executeRemoteAccessCommand(
      "r8",
      { type: "remoteAccess.setEnabled", enabled: false },
      services({ pairing, remoteControl })
    );
    expect(result).toEqual({
      data: { enabled: false },
      ok: true,
      requestId: "r8",
    });
    expect(remoteControl.owner.stop).toHaveBeenCalledTimes(1);
    expect(remoteControl.owner.start).not.toHaveBeenCalled();
  });
});

describe("remoteAccess.beginPairing", () => {
  it("已启用：返回 { code, qrPayload, expiresAt }，码为 6 位数字", async () => {
    const pairing = await makePairing();
    const result = await executeRemoteAccessCommand(
      "r9",
      { type: "remoteAccess.beginPairing" },
      services({ pairing, remoteControl: makeRemoteControl(true) })
    );
    const data = okData(result);
    expect(data.code).toMatch(/^\d{6}$/);
    expect(data.expiresAt).toBe(nowMs + PAIRING_CODE_TTL_MS);
    expect(data.qrPayload).toEqual(expect.any(String));
    const qr = JSON.parse(data.qrPayload as string) as Record<string, unknown>;
    expect(qr).toMatchObject({
      host: HOST,
      pairingCode: data.code,
      port: PORT,
    });
  });

  it("未启用：platform_unavailable 且不签发配对码", async () => {
    const pairing = await makePairing();
    const result = await executeRemoteAccessCommand(
      "r10",
      { type: "remoteAccess.beginPairing" },
      services({ pairing, remoteControl: makeRemoteControl(false) })
    );
    expect(result).toMatchObject({
      error: { code: "platform_unavailable" },
      ok: false,
    });
    expect(pairing.pendingPairing()).toBeNull();
  });
});

describe("remoteAccess.cancelPairing", () => {
  it("清除待决配对码：getState 回落 null 且旧码不可再 redeem", async () => {
    const pairing = await makePairing();
    const deps = services({ pairing, remoteControl: makeRemoteControl(true) });
    const begin = await executeRemoteAccessCommand(
      "r11",
      { type: "remoteAccess.beginPairing" },
      deps
    );
    const { code } = okData(begin) as { code: string };
    const cancel = await executeRemoteAccessCommand(
      "r12",
      { type: "remoteAccess.cancelPairing" },
      deps
    );
    expect(cancel).toEqual({ data: null, ok: true, requestId: "r12" });
    const state = await executeRemoteAccessCommand(
      "r13",
      { type: "remoteAccess.getState" },
      deps
    );
    expect(okData(state).pendingPairing).toBeNull();
    expect(await pairing.redeemPairingCode(redeemRequest(code))).toEqual({
      ok: false,
      reason: "pairing_invalid",
    });
  });
});

describe("remoteAccess.revokeDevice", () => {
  it("吊销已配对设备：success 且设备列表清空", async () => {
    const pairing = await makePairing();
    const issued = pairing.beginPairing({ host: HOST, port: PORT });
    const redeemed = await pairing.redeemPairingCode(
      redeemRequest(issued.code)
    );
    if (!redeemed.ok) {
      throw new Error("redeem failed");
    }
    const result = await executeRemoteAccessCommand(
      "r14",
      { type: "remoteAccess.revokeDevice", deviceId: redeemed.deviceId },
      services({ pairing, remoteControl: makeRemoteControl(true) })
    );
    expect(result).toEqual({
      data: { revoked: true },
      ok: true,
      requestId: "r14",
    });
    expect(pairing.listDevices()).toEqual([]);
  });

  it("未知 deviceId → not_found", async () => {
    const pairing = await makePairing();
    const result = await executeRemoteAccessCommand(
      "r15",
      { type: "remoteAccess.revokeDevice", deviceId: "dev-unknown" },
      services({ pairing, remoteControl: makeRemoteControl(true) })
    );
    expect(result).toMatchObject({
      error: { code: "not_found" },
      ok: false,
    });
  });
});
