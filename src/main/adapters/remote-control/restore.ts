/**
 * 远程访问开关启动恢复：用户显式开启过（pairing.json 的
 * remoteAccessEnabled）→ 重启自动恢复 LAN 监听与会合拨号；从未开启或
 * 显式关闭 → 维持默认关。产品承诺「保持这台电脑唤醒且开启远程访问，
 * 手机随时接入」依赖此恢复——否则每次重启都要人肉再开一次开关。
 *
 * 失败只记日志：启动路径无用户动作可反馈；设置页开关仍可手动恢复。
 */

export interface RemoteAccessRestoreDeps {
  log(message: string, fields: Record<string, unknown>): void;
  pairing: {
    ensureReady(): Promise<void>;
    remoteAccessEnabled(): boolean;
  };
  remoteControl?: {
    owner: { start(): Promise<unknown> };
    uplink?: { start(): void } | null | undefined;
  };
}

export async function restoreRemoteAccessOnBoot(
  deps: RemoteAccessRestoreDeps
): Promise<void> {
  const { pairing, remoteControl } = deps;
  if (!remoteControl) {
    return;
  }
  try {
    await pairing.ensureReady();
    if (!pairing.remoteAccessEnabled()) {
      return;
    }
    await remoteControl.owner.start();
    remoteControl.uplink?.start();
  } catch (error) {
    deps.log("remote access restore failed", { error });
  }
}
