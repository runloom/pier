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
 * 演进只许 additive 可选字段（未来可选账号层才加 accountId?，M2 无账号交付——
 * 规格第十三次修订）——保持纯 TS interface，
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
    /** M2：宿主身份（公钥哈希）自证明 id，会合路由与赎回定向用（服务端设计 §4）。 */
    hostId: z.string().min(1).optional(),
    pairingCode: z.string().min(1),
    /**
     * M2：高熵配对密钥（32 字节 base64url ≥ 43 字符，仅经 QR 带外传递）。
     * 赎回往返经其派生的 pairKey 密封，relay 全程不见令牌（服务端设计 §5.3）；
     * 人工输码（无 pairSecret）仅允许 LAN 直连赎回，relay 路径拒绝。
     */
    pairSecret: z.string().min(43).optional(),
    port: z.number().int().positive().optional(),
    /** 未配置会合时恒 null；已配置为会合 wss URL（M2，服务端设计 §5）。 */
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

// ---- M2 冻结与保留位（字段语义见规格 §17.3；账号相关为保留位）----

/**
 * M2 冻结 · 保留位（未来可选账号层）：M2 无账号交付，不实现（规格第十三次修订）。
 * 所有引用走不透明 accountId。
 */
export const pierAccountRefSchema = z
  .object({ accountId: z.string().min(1) })
  .strict();
export type PierAccountRef = z.infer<typeof pierAccountRefSchema>;

/**
 * M2 冻结 · 保留位（未来可选账号层）：M2 会合零持久化，
 * 在线态与设备名册为内存担保（服务端设计 §3），本类型不实现。
 */
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

/** M2：Web Push 载荷（宿主直发 → Service Worker 展示；additive 契约）。 */
export const pierRemotePushPayloadSchema = z
  .object({
    title: z.string().min(1).max(300),
    body: z.string().max(1000).optional(),
    /** PWA 内路由深链（notificationclick 打开）。 */
    path: z.string().max(500).optional(),
    /** 与消息中心合并去重的键（toast 副本按此标已读的同源语义）。 */
    dedupeKey: z.string().max(300).optional(),
  })
  .strict();
export type PierRemotePushPayload = z.infer<typeof pierRemotePushPayloadSchema>;

/** M2 冻结：会合转发信封；frame 透传 v2 帧，relay 不解读、不授权。 */
export const pierRelayEnvelopeSchema = z
  .object({
    hostId: z.string().min(1),
    deviceId: z.string().min(1),
    frame: z.unknown(),
  })
  .strict();
export type PierRelayEnvelope = z.infer<typeof pierRelayEnvelopeSchema>;
