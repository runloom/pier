/**
 * §9.1 回前台恢复：已连接 → 立即拉全量快照；断线中 → 立即重拨
 * （connect 重入取消退避）；closed（吊销/用户关闭）不自动复活。
 */
import type { ControlSnapshotPayload } from "@shared/contracts/local-control/control-snapshot.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MobileConnectionStatus } from "../../../apps/mobile-web/src/lib/client-types.ts";
import type { StoredHost } from "../../../apps/mobile-web/src/lib/paired-hosts.ts";

const { instances } = vi.hoisted(() => ({
  instances: [] as Array<{
    close: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
    request: ReturnType<typeof vi.fn>;
    status: MobileConnectionStatus;
    watch: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock("../../../apps/mobile-web/src/lib/client.ts", () => {
  class MockPierMobileClient {
    status: MobileConnectionStatus = "idle";
    connect = vi.fn(async () => {
      this.status = "connected";
      return {} as never;
    });
    watch = vi.fn(() => Promise.resolve());
    request = vi.fn(async () => snapshotFixture());
    close = vi.fn(() => {
      this.status = "closed";
    });

    constructor() {
      instances.push(this as never);
    }
  }
  return { PierMobileClient: MockPierMobileClient };
});

import {
  connectHost,
  resumeActiveHost,
} from "../../../apps/mobile-web/src/lib/session.ts";
import { useMobileWebStore } from "../../../apps/mobile-web/src/lib/store.ts";

function snapshotFixture(): ControlSnapshotPayload {
  return {
    activity: [],
    agents: [],
    bootId: "boot-resume",
    capturedAt: 1,
    notifications: [],
    panels: [],
    revision: 7,
    runtimes: [],
    tasks: [],
    windows: [],
    worktrees: [],
  };
}

const HOST: StoredHost = {
  deviceId: "dev-1",
  deviceToken: "tok-1",
  host: "192.168.1.2",
  pairedAt: 1,
  port: 4455,
};

describe("resumeActiveHost（回前台恢复）", () => {
  afterEach(() => {
    useMobileWebStore.setState({ connection: "idle", snapshot: null });
  });

  it("已连接拉快照；断线立即重拨；closed 不复活", async () => {
    await connectHost(HOST);
    const client = instances[0];
    if (client === undefined) {
      throw new Error("mock client not constructed");
    }
    expect(client.connect).toHaveBeenCalledTimes(1);

    // 已连接：只补拉全量快照，不重拨。
    client.status = "connected";
    await resumeActiveHost();
    expect(client.request).toHaveBeenCalledWith("control.snapshot");
    expect(useMobileWebStore.getState().snapshot?.bootId).toBe("boot-resume");
    expect(client.connect).toHaveBeenCalledTimes(1);

    // 断线中（退避等待）：立即重拨。
    client.status = "reconnecting";
    await resumeActiveHost();
    expect(client.connect).toHaveBeenCalledTimes(2);

    // closed（吊销/用户关闭）：不自动复活。
    client.status = "closed";
    await resumeActiveHost();
    expect(client.connect).toHaveBeenCalledTimes(2);
  });
});
