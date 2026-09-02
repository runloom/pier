/**
 * 移动端接入相关命令的授权 metadata（从 metadata-table 按域抽出）：
 * Web Push 句柄、审批回写、宿主远程访问管理面。并入 COMMAND_METADATA 穷举表。
 */
import type { CommandMetadata } from "./metadata-table.ts";

/** 键覆盖全部移动端接入命令；宿主 metadata-table spread 后仍是穷举 Record。 */
export const MOBILE_COMMAND_METADATA = {
  // Web Push 句柄（M2，规格 §12）：仅配对移动端；deviceId 取会话身份。
  "notifications.getPushPublicKey": {
    allowedClientKinds: ["mobile-paired"],
    capabilities: ["notification:read"],
  },
  "notifications.registerPushHandle": {
    allowedClientKinds: ["mobile-paired"],
    capabilities: ["notification:write"],
  },
  "notifications.unregisterPushHandle": {
    allowedClientKinds: ["mobile-paired"],
    capabilities: ["notification:write"],
  },
  // M1 审批回写：桌面 + 配对移动端；按键回写属通知处置闭环（notification:write）。
  "agent.attention.respond": {
    allowedClientKinds: ["desktop-renderer", "mobile-paired"],
    capabilities: ["notification:write"],
  },
  // M1 宿主远程访问管理面：配对与启停只许桌面，移动端/CLI 不过 kind 门。
  "remoteAccess.getState": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["remote-access:read"],
  },
  "remoteAccess.setEnabled": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["remote-access:control"],
  },
  "remoteAccess.beginPairing": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["remote-access:control"],
  },
  "remoteAccess.cancelPairing": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["remote-access:control"],
  },
  "remoteAccess.revokeDevice": {
    allowedClientKinds: ["desktop-renderer"],
    capabilities: ["remote-access:control"],
  },
} as const satisfies Record<string, CommandMetadata>;
