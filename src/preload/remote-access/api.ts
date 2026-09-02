import type { PierPairedDevice } from "@shared/contracts/remote.ts";
import { invokePierCommand } from "../ipc-envelope.ts";

/**
 * Preload facade for `window.pier.remoteAccess`（M1 宿主远程访问管理面，
 * Task 10）。五个方法全部经统一 PIER.COMMAND_EXECUTE 通道 →
 * command-router → commands/remote-access.ts（Task 9），不新造 IPC 通道。
 */

/** 出网设备视图：main 侧 getState 已剥离 tokenHash（字段白名单，永不带令牌哈希出网）。 */
export type RemoteAccessDevice = Omit<PierPairedDevice, "tokenHash">;

/** 待决配对的 QR 视图：占位未过期且为本进程签发时非空。 */
export interface RemoteAccessPendingPairing {
  expiresAt: number;
  qrPayload: string;
}

/** M2 跨网远程状态：会合是否配置 + 出站拨号连接态。 */
export interface RemoteAccessRemoteState {
  configured: boolean;
  connectionState: "stopped" | "connecting" | "connected" | "backoff";
}

export interface RemoteAccessState {
  /** 固定 true：标记响应已跨越脱敏边界（设备列表无 tokenHash）。 */
  boundaryNote: true;
  devices: RemoteAccessDevice[];
  enabled: boolean;
  host: string | null;
  pendingPairing: RemoteAccessPendingPairing | null;
  port: number | null;
  /** M2：会合跨网远程状态（configured=false 时纯 LAN，设置卡隐藏该区）。 */
  remote: RemoteAccessRemoteState;
}

/** beginPairing 签发结果：6 位明码配对码只出现在此次响应。 */
export interface RemoteAccessPairingChallenge {
  code: string;
  expiresAt: number;
  qrPayload: string;
}

export interface RemoteAccessPreloadApi {
  beginPairing(): Promise<RemoteAccessPairingChallenge>;
  cancelPairing(): Promise<null>;
  getState(): Promise<RemoteAccessState>;
  revokeDevice(deviceId: string): Promise<{ revoked: boolean }>;
  setEnabled(enabled: boolean): Promise<{ enabled: boolean }>;
}

export function createRemoteAccessPreloadApi(): RemoteAccessPreloadApi {
  return {
    beginPairing: () =>
      invokePierCommand<RemoteAccessPairingChallenge>({
        type: "remoteAccess.beginPairing",
      }),
    cancelPairing: () =>
      invokePierCommand<null>({ type: "remoteAccess.cancelPairing" }),
    getState: () =>
      invokePierCommand<RemoteAccessState>({ type: "remoteAccess.getState" }),
    revokeDevice: (deviceId) =>
      invokePierCommand<{ revoked: boolean }>({
        deviceId,
        type: "remoteAccess.revokeDevice",
      }),
    setEnabled: (enabled) =>
      invokePierCommand<{ enabled: boolean }>({
        enabled,
        type: "remoteAccess.setEnabled",
      }),
  };
}
