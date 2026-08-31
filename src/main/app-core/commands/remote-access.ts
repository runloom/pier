/**
 * remoteAccess.*（M1 宿主远程访问管理命令面，Task 9）。
 *
 * 五条命令全部仅 desktop-renderer（metadata kind 门）；能力分闸：
 * getState = remote-access:read，其余四条 = remote-access:control。
 *
 * 依赖经 services 注入（装配见 Task 13 app-core/index.ts）：
 * - remoteControl.server.state() 镜像 enabled/host/port；
 * - remoteControl.owner 串行化 start/stop（setEnabled）；
 * - pairing 提供配对码签发/取消/吊销与设备列表。
 *
 * 脱敏边界：getState 出网设备列表剥离 tokenHash（令牌哈希永不出服务面），
 * boundaryNote: true 标记该响应已跨越此脱敏边界。
 */
import type {
  PierCommand,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import type { PierPairedDevice } from "@shared/contracts/remote.ts";
import {
  commandFailure as failure,
  commandSuccess as success,
} from "../command-results.ts";
import type { PierCoreServices } from "../command-router-services.ts";

/** 出网设备视图：PierPairedDevice 去掉 tokenHash（字段白名单，新增字段默认不出网）。 */
type SanitizedPairedDevice = Omit<PierPairedDevice, "tokenHash">;

type RemoteAccessCommand = Extract<
  PierCommand,
  { type: `remoteAccess.${string}` }
>;

function isRemoteAccessCommand(
  command: PierCommand
): command is RemoteAccessCommand {
  return command.type.startsWith("remoteAccess.");
}

export async function executeRemoteAccessCommand(
  requestId: string,
  command: PierCommand,
  services: PierCoreServices
): Promise<PierCommandResult | null> {
  if (!isRemoteAccessCommand(command)) {
    return null;
  }
  const { pairing, remoteControl } = services;
  if (!(pairing && remoteControl)) {
    return failure(
      requestId,
      "platform_unavailable",
      "remote access services not assembled"
    );
  }
  await pairing.ensureReady();
  switch (command.type) {
    case "remoteAccess.getState": {
      const state = remoteControl.server.state();
      const uplink = remoteControl.uplink ?? null;
      return success(requestId, {
        boundaryNote: true,
        devices: pairing.listDevices().map(
          (device): SanitizedPairedDevice => ({
            capabilities: [...device.capabilities],
            createdAt: device.createdAt,
            deviceId: device.deviceId,
            lastSeenAt: device.lastSeenAt,
            name: device.name,
            shell: device.shell,
            tokenEpoch: device.tokenEpoch,
          })
        ),
        enabled: state.enabled,
        host: state.host,
        pendingPairing: pairing.pendingPairing(),
        port: state.port,
        // M2 跨网远程：会合未配置（纯 LAN 形态）时 configured=false，
        // 设置卡据此隐藏「跨网远程」区（uplink 为 null）。
        remote: {
          configured: uplink !== null,
          connectionState: uplink?.state() ?? "stopped",
        },
      });
    }
    case "remoteAccess.setEnabled": {
      if (command.enabled) {
        await remoteControl.owner.start();
        // 会合拨号与 LAN 监听同门启停（配置了 relay 地址才存在）。
        remoteControl.uplink?.start();
      } else {
        remoteControl.uplink?.stop();
        await remoteControl.owner.stop();
      }
      // 显式选择写盘：重启后 restoreRemoteAccessOnBoot 按此恢复（默认关不变）。
      pairing.setRemoteAccessEnabled(command.enabled);
      return success(requestId, {
        enabled: remoteControl.server.state().enabled,
      });
    }
    case "remoteAccess.beginPairing": {
      const state = remoteControl.server.state();
      if (!state.enabled || state.host === null || state.port === null) {
        return failure(
          requestId,
          "platform_unavailable",
          "remote access is disabled"
        );
      }
      return success(
        requestId,
        pairing.beginPairing({ host: state.host, port: state.port })
      );
    }
    case "remoteAccess.cancelPairing": {
      pairing.cancelPairing();
      return success(requestId, null);
    }
    case "remoteAccess.revokeDevice": {
      const { revoked } = pairing.revokeDevice(command.deviceId);
      if (!revoked) {
        return failure(
          requestId,
          "not_found",
          `device not found: ${command.deviceId}`
        );
      }
      return success(requestId, { revoked: true });
    }
    default:
      return null;
  }
}
