// @vitest-environment node
/**
 * 远程访问开关启动恢复：开过 → 重启自动恢复（owner.start + uplink.start）；
 * 从未开启 / 显式关闭 → 维持默认关；恢复失败只记日志不抛。
 */
import { restoreRemoteAccessOnBoot } from "@main/adapters/remote-control/restore.ts";
import { describe, expect, it, vi } from "vitest";

function makeDeps(opts: {
  enabled: boolean;
  startError?: Error;
  uplink?: boolean;
}) {
  const start = opts.startError
    ? vi.fn(async () => {
        throw opts.startError;
      })
    : vi.fn(async () => undefined);
  const uplinkStart = vi.fn();
  const log = vi.fn();
  return {
    deps: {
      log,
      pairing: {
        ensureReady: async () => undefined,
        remoteAccessEnabled: () => opts.enabled,
      },
      remoteControl: {
        owner: { start },
        uplink: opts.uplink === false ? null : { start: uplinkStart },
      },
    },
    log,
    start,
    uplinkStart,
  };
}

describe("restoreRemoteAccessOnBoot", () => {
  it("持久化为开 → 恢复监听并拨会合", async () => {
    const { deps, start, uplinkStart } = makeDeps({ enabled: true });
    await restoreRemoteAccessOnBoot(deps);
    expect(start).toHaveBeenCalledTimes(1);
    expect(uplinkStart).toHaveBeenCalledTimes(1);
  });

  it("持久化为关（或从未开启）→ 不启动任何监听", async () => {
    const { deps, start, uplinkStart } = makeDeps({ enabled: false });
    await restoreRemoteAccessOnBoot(deps);
    expect(start).not.toHaveBeenCalled();
    expect(uplinkStart).not.toHaveBeenCalled();
  });

  it("无 uplink（未配置会合）→ 只恢复 LAN 监听", async () => {
    const { deps, start } = makeDeps({ enabled: true, uplink: false });
    await restoreRemoteAccessOnBoot(deps);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("remoteControl 未装配 → no-op", async () => {
    const { deps, start } = makeDeps({ enabled: true });
    await restoreRemoteAccessOnBoot({
      log: deps.log,
      pairing: deps.pairing,
    });
    expect(start).not.toHaveBeenCalled();
  });

  it("start 抛错 → 记日志不上抛", async () => {
    const { deps, log, uplinkStart } = makeDeps({
      enabled: true,
      startError: new Error("port busy"),
    });
    await expect(restoreRemoteAccessOnBoot(deps)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledTimes(1);
    expect(uplinkStart).not.toHaveBeenCalled();
  });
});
