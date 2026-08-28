/**
 * 移动端配对会话契约：live session 绑定可吊销的设备 epoch。
 */
import { describe, expect, it } from "vitest";
import type {
  PierPairedDevice,
  PierRemoteSession,
} from "../../../../src/shared/contracts/remote.ts";

describe("mobile-paired session identity", () => {
  it("binds a live session to a revocable device epoch", () => {
    const device = {
      capabilities: ["notification:write"],
      createdAt: 1,
      deviceId: "dev-1",
      lastSeenAt: 1,
      name: "phone",
      shell: "web",
      tokenEpoch: 4,
      tokenHash: "hash",
    } satisfies PierPairedDevice;
    const session = {
      capabilities: device.capabilities,
      clientId: "ws-1",
      createdAt: 2,
      deviceId: device.deviceId,
      kind: "mobile-paired",
      tokenEpoch: device.tokenEpoch,
    } satisfies PierRemoteSession;
    expect(session.deviceId).toBe(device.deviceId);
    expect(session.tokenEpoch).toBe(4);
  });
});
