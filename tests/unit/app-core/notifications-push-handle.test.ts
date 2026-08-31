// @vitest-environment node
/**
 * 推送句柄命令面（M2 Task 8）：deviceId 只取会话身份（防伪造他机句柄）、
 * 非移动会话拒绝、getPushPublicKey 就绪链。
 */

import type { PierCoreServices } from "@main/app-core/command-router-services.ts";
import { executePushHandleCommand } from "@main/app-core/commands/notifications-push-handle.ts";
import type { RemotePushService } from "@main/services/remote-push/service.ts";
import type { PierCommandResult } from "@shared/contracts/commands.ts";
import { describe, expect, it, vi } from "vitest";

function makeRemotePush(): RemotePushService & {
  registered: Array<{ deviceId: string }>;
} {
  const registered: Array<{ deviceId: string }> = [];
  return {
    candidates: () => [],
    ensureReady: vi.fn(async () => undefined),
    handles: () => [],
    publicKey: () => "vapid-public",
    registerHandle: (deviceId) => {
      registered.push({ deviceId });
    },
    registered,
    send: async () => undefined,
    unregisterHandle: (deviceId) => {
      registered.splice(
        0,
        registered.length,
        ...registered.filter((entry) => entry.deviceId !== deviceId)
      );
    },
  };
}

function services(remotePush?: RemotePushService): PierCoreServices {
  return { ...(remotePush ? { remotePush } : {}) } as never;
}

const WEB_PUSH = {
  endpoint: "https://push.example.com/sub",
  keys: { auth: "a", p256dh: "p" },
};

function okData(result: PierCommandResult | null): Record<string, unknown> {
  if (!result?.ok) {
    throw new Error(`expected ok, got ${JSON.stringify(result)}`);
  }
  return result.data as Record<string, unknown>;
}

describe("executePushHandleCommand", () => {
  it("register/unregister 用会话 deviceId（mobile:<id>），忽略任何入参伪造面", async () => {
    const remotePush = makeRemotePush();
    const register = await executePushHandleCommand(
      "r1",
      { type: "notifications.registerPushHandle", webPush: WEB_PUSH },
      services(remotePush),
      { clientId: "mobile:dev-9" }
    );
    expect(okData(register)).toEqual({ registered: true });
    expect(remotePush.registered).toEqual([{ deviceId: "dev-9" }]);

    const unregister = await executePushHandleCommand(
      "r2",
      { type: "notifications.unregisterPushHandle" },
      services(remotePush),
      { clientId: "mobile:dev-9" }
    );
    expect(okData(unregister)).toEqual({ registered: false });
    expect(remotePush.registered).toEqual([]);
  });

  it("非移动会话（desktop / 缺 clientId）拒绝", async () => {
    const remotePush = makeRemotePush();
    for (const clientId of [undefined, "renderer:1", "mobile:"]) {
      const result = await executePushHandleCommand(
        "r3",
        { type: "notifications.registerPushHandle", webPush: WEB_PUSH },
        services(remotePush),
        clientId === undefined ? {} : { clientId }
      );
      expect(result?.ok).toBe(false);
    }
    expect(remotePush.registered).toEqual([]);
  });

  it("getPushPublicKey 先就绪后取键；服务未装配 → platform_unavailable", async () => {
    const remotePush = makeRemotePush();
    const result = await executePushHandleCommand(
      "r4",
      { type: "notifications.getPushPublicKey" },
      services(remotePush),
      { clientId: "mobile:dev-1" }
    );
    expect(okData(result)).toEqual({ publicKey: "vapid-public" });
    expect(remotePush.ensureReady).toHaveBeenCalled();

    const missing = await executePushHandleCommand(
      "r5",
      { type: "notifications.getPushPublicKey" },
      services(),
      { clientId: "mobile:dev-1" }
    );
    expect(missing?.ok).toBe(false);
  });

  it("非本域命令返回 null（路由器继续下一执行器）", async () => {
    const result = await executePushHandleCommand(
      "r6",
      { type: "notifications.list" },
      services(makeRemotePush()),
      { clientId: "mobile:dev-1" }
    );
    expect(result).toBeNull();
  });
});
