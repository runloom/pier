/**
 * 移动端远程接入：协议与数据模型单一来源（规格 §17）。
 * 纯 zod/TS 契约，无任何运行时环境依赖；M1 实现标注子集，
 * 标注「M2 冻结」的现在定义、M2 才实现。
 * @see docs/superpowers/specs/2026-08-26-mobile-companion-design.md
 */
import { z } from "zod";
import {
  type PierCapability,
  type PierClientKind,
  pierCapabilitySchema,
} from "./permissions.ts";

/** 伴侣壳：Web（首壳）/ App / 小程序；pierPushHandle 与帧 auth 复用此单一来源。 */
export const pierCompanionShellSchema = z.enum(["web", "app", "miniprogram"]);
export type PierCompanionShell = z.infer<typeof pierCompanionShellSchema>;

/**
 * 演进只许 additive 可选字段（M2 加 accountId?）——保持纯 TS interface，
 * pairing-store 磁盘 schema 逐字段镜像对齐，禁止在此 zod 化。
 */
export interface PierPairedDevice {
  capabilities: PierCapability[];
  createdAt: number;
  deviceId: string;
  lastSeenAt: number;
  name: string;
  shell: PierCompanionShell;
  tokenEpoch: number;
  tokenHash: string;
}

export interface PierRemoteSession {
  capabilities: PierCapability[];
  clientId: string;
  createdAt: number;
  deviceId: string;
  expiresAt?: number;
  kind: PierClientKind;
  tokenEpoch: number;
}

/** POST /pair 请求体（规格 §17.2）。 */
export const pierPairingRequestSchema = z.object({
  code: z.string().min(1),
  requestedCapabilities: z.array(pierCapabilitySchema),
  shell: pierCompanionShellSchema.optional(),
  /** 设备自报名（可选，最长 64）；缺省由宿主派生占位名。 */
  name: z.string().min(1).max(64).optional(),
});
export type PierPairingRequest = z.infer<typeof pierPairingRequestSchema>;

/** 配对 QR 载荷（规格 §17.2）：移动端扫码连入的自描述 JSON。 */
export const pairingQrPayloadSchema = z
  .object({
    fingerprint: z.string().min(1),
    host: z.string().min(1).optional(),
    pairingCode: z.string().min(1),
    port: z.number().int().positive().optional(),
    /** M1 恒 null；M2 会合地址。 */
    relayHint: z.string().nullable(),
  })
  .strict();
export type PairingQrPayload = z.infer<typeof pairingQrPayloadSchema>;

/** POST /pair 200 响应体（规格 §17.2）；令牌原文只出现在此次响应。 */
export const pairingRedeemResultSchema = z
  .object({
    deviceId: z.string().min(1),
    deviceToken: z.string().min(1),
    grantedCapabilities: z.array(pierCapabilitySchema),
    tokenEpoch: z.number().int().nonnegative(),
  })
  .strict();
export type PairingRedeemPayload = z.infer<typeof pairingRedeemResultSchema>;

/** POST /pair 403 响应体 reason（规格 §17.2），不占帧错误码。 */
export const pairingFailureReasonSchema = z.enum([
  "pairing_expired",
  "pairing_invalid",
]);
export type PairingFailureReason = z.infer<typeof pairingFailureReasonSchema>;

// ---- M2 冻结（现在定义、M2 实现；字段语义见规格 §17.3）----

/** M2 冻结：账号形态开放（D4），所有引用走不透明 accountId。 */
export const pierAccountRefSchema = z
  .object({ accountId: z.string().min(1) })
  .strict();
export type PierAccountRef = z.infer<typeof pierAccountRefSchema>;

/** M2 冻结：会合云注册表条目；宿主出站拨号后置 online。 */
export const pierHostRegistrationSchema = z
  .object({
    hostId: z.string().min(1),
    accountId: z.string().min(1),
    fingerprint: z.string().min(1),
    online: z.boolean(),
    lastSeenAt: z.number().int().nonnegative(),
  })
  .strict();
export type PierHostRegistration = z.infer<typeof pierHostRegistrationSchema>;

/** M2 冻结：推送句柄按 shell 分叉；app / miniprogram 形态随各壳立项。 */
export const pierPushHandleSchema = z
  .object({
    deviceId: z.string().min(1),
    shell: pierCompanionShellSchema,
    webPush: z
      .object({
        endpoint: z.string().url(),
        keys: z
          .object({
            p256dh: z.string().min(1),
            auth: z.string().min(1),
          })
          .strict(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type PierPushHandle = z.infer<typeof pierPushHandleSchema>;

/** M2 冻结：会合转发信封；frame 透传 v2 帧，relay 不解读、不授权。 */
export const pierRelayEnvelopeSchema = z
  .object({
    hostId: z.string().min(1),
    deviceId: z.string().min(1),
    frame: z.unknown(),
  })
  .strict();
export type PierRelayEnvelope = z.infer<typeof pierRelayEnvelopeSchema>;
