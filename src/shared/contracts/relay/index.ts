/**
 * 会合云（relay）帧契约单一来源：relay / 宿主 / Web 壳三端共用。
 * 文字权威：docs/superpowers/specs/2026-08-31-mobile-relay-server-design.md §5。
 *
 * 纪律：
 * - 纯 JSON 文本契约，零运行时环境依赖（沿用 M1 帧协议冻结锁）；
 * - wire 取扁平：uplink 帧只带 deviceId（hostId 由连接隐含）、downlink 直发
 *   载体联合（管道已绑定二元组）；冻结的 `pierRelayEnvelopeSchema` 全形保留为
 *   概念路由元组与未来多区域 mesh 预留（remote.ts，不删除）；
 * - relay 对 `RelayEnvelopeFrame` 只路由不解析（治理锁：服务端设计 §13）。
 */
import { z } from "zod";

export const RELAY_PROTOCOL_VERSION = 1;

// ---- 载体：密文帧 / 明文通道握手（服务端设计 §6）----

/**
 * AES-256-GCM 密封帧；`seq` 入 AAD 防重放（接收侧拒绝 ≤ 已见值）。
 * 赎回等一次性密封固定 `seq: 0`（接收侧以 lastSeq=-1 校验）。
 */
export const relaySealedFrameSchema = z
  .object({
    kind: z.literal("sealed"),
    v: z.literal(1),
    seq: z.number().int().nonnegative(),
    iv: z.string().min(1),
    ct: z.string().min(1),
  })
  .strict();
export type RelaySealedFrame = z.infer<typeof relaySealedFrameSchema>;

/** 通道握手（PSK+ECDHE，前向保密）：nonce 与 P-256 临时公钥都不是秘密。 */
export const channelHandshakeFrameSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("channel.init"),
      clientNonce: z.string().min(1),
      clientEphPub: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("channel.ack"),
      hostNonce: z.string().min(1),
      hostEphPub: z.string().min(1),
    })
    .strict(),
]);
export type ChannelHandshakeFrame = z.infer<typeof channelHandshakeFrameSchema>;

/** envelope 载体联合：密文帧或明文握手（仅 channel.init / channel.ack）。 */
export const relayEnvelopeFrameSchema = z.discriminatedUnion("kind", [
  relaySealedFrameSchema,
  z
    .object({
      kind: z.literal("plain"),
      handshake: channelHandshakeFrameSchema,
    })
    .strict(),
]);
export type RelayEnvelopeFrame = z.infer<typeof relayEnvelopeFrameSchema>;

// ---- 传输层错误（relay 级；device_revoked 是宿主判定，在密文帧内回）----

export const relayErrorCodeSchema = z.enum([
  "host_offline",
  "auth_failed",
  "rate_limited",
  "protocol_too_old",
  "protocol_error",
]);
export type RelayErrorCode = z.infer<typeof relayErrorCodeSchema>;

export const relayServerErrorFrameSchema = z
  .object({
    type: z.literal("server.error"),
    code: relayErrorCodeSchema,
    message: z.string().optional(),
  })
  .strict();
export type RelayServerErrorFrame = z.infer<typeof relayServerErrorFrameSchema>;

// ---- uplink（宿主 ↔ relay，每宿主一条常驻）----

export const serverChallengeFrameSchema = z
  .object({ type: z.literal("server.challenge"), nonce: z.string().min(1) })
  .strict();
export type ServerChallengeFrame = z.infer<typeof serverChallengeFrameSchema>;

/** 名册条目：relay 只见通行证哈希（服务端设计 §4）。 */
export const rosterEntrySchema = z
  .object({ deviceId: z.string().min(1), relayPassHash: z.string().min(1) })
  .strict();
export type RosterEntry = z.infer<typeof rosterEntrySchema>;

/** 挑战应答：`hostId` 必须等于 sha256(hostPubKey)（自证明，relay 复核）。 */
export const uplinkHelloFrameSchema = z
  .object({
    type: z.literal("uplink.hello"),
    protocolVersion: z.literal(RELAY_PROTOCOL_VERSION),
    hostId: z.string().min(1),
    hostPubKey: z.string().min(1),
    signature: z.string().min(1),
    roster: z.array(rosterEntrySchema),
  })
  .strict();
export type UplinkHelloFrame = z.infer<typeof uplinkHelloFrameSchema>;

export const uplinkReadyFrameSchema = z
  .object({ type: z.literal("uplink.ready") })
  .strict();

/** 名册增删：配对成功 upsert / 吊销 remove（relay 断该设备全部 downlink）。 */
export const rosterUpdateFrameSchema = z
  .object({
    type: z.literal("roster.update"),
    upsert: z.array(rosterEntrySchema).optional(),
    remove: z.array(z.string().min(1)).optional(),
  })
  .strict();
export type RosterUpdateFrame = z.infer<typeof rosterUpdateFrameSchema>;

/** uplink 复用包装：只带 deviceId，hostId 由连接隐含（wire 扁平化）。 */
export const uplinkEnvelopeFrameSchema = z
  .object({
    type: z.literal("envelope"),
    deviceId: z.string().min(1),
    frame: relayEnvelopeFrameSchema,
  })
  .strict();
export type UplinkEnvelopeFrame = z.infer<typeof uplinkEnvelopeFrameSchema>;

/** 赎回盲传：relay 只搬密文（服务端设计 §5.3）。 */
export const pairRequestFrameSchema = z
  .object({
    type: z.literal("pair.request"),
    requestId: z.string().min(1),
    sealedRequest: relaySealedFrameSchema,
  })
  .strict();
export type PairRequestFrame = z.infer<typeof pairRequestFrameSchema>;

/** `ok` 仅供 relay 做限速记账与 HTTP 状态映射；结果本体始终是密文。 */
export const pairResultFrameSchema = z
  .object({
    type: z.literal("pair.result"),
    requestId: z.string().min(1),
    ok: z.boolean(),
    sealedResult: relaySealedFrameSchema,
  })
  .strict();
export type PairResultFrame = z.infer<typeof pairResultFrameSchema>;

/** 宿主 → relay 的全部帧。 */
export const uplinkClientFrameSchema = z.discriminatedUnion("type", [
  uplinkHelloFrameSchema,
  rosterUpdateFrameSchema,
  uplinkEnvelopeFrameSchema,
  pairResultFrameSchema,
]);
export type UplinkClientFrame = z.infer<typeof uplinkClientFrameSchema>;

/**
 * 该设备最后一条 downlink 已断开。宿主应销毁对应虚拟通道，
 * 否则 clients 仍登记「在线」，remotePush 会把该设备剔掉。
 */
export const downlinkGoneFrameSchema = z
  .object({
    type: z.literal("downlink.gone"),
    deviceId: z.string().min(1),
  })
  .strict();
export type DownlinkGoneFrame = z.infer<typeof downlinkGoneFrameSchema>;

/** relay → 宿主的全部帧。 */
export const uplinkServerFrameSchema = z.discriminatedUnion("type", [
  serverChallengeFrameSchema,
  uplinkReadyFrameSchema,
  uplinkEnvelopeFrameSchema,
  pairRequestFrameSchema,
  downlinkGoneFrameSchema,
  relayServerErrorFrameSchema,
]);
export type UplinkServerFrame = z.infer<typeof uplinkServerFrameSchema>;

// ---- downlink（手机 ↔ relay，每「设备×宿主」一条按需）----

/** deviceToken 不出现——令牌只对宿主出示；relay 只验名册通行证哈希。 */
export const downlinkHelloFrameSchema = z
  .object({
    type: z.literal("downlink.hello"),
    protocolVersion: z.literal(RELAY_PROTOCOL_VERSION),
    hostId: z.string().min(1),
    deviceId: z.string().min(1),
    relayPass: z.string().min(1),
  })
  .strict();
export type DownlinkHelloFrame = z.infer<typeof downlinkHelloFrameSchema>;

export const downlinkReadyFrameSchema = z
  .object({ type: z.literal("downlink.ready") })
  .strict();

/**
 * downlink wire（hello 之后）：载体联合**直发**，不套 envelope 包装
 * （管道已绑定 (hostId, deviceId)，省一层嵌套——服务端设计 §5.2）。
 */
export const downlinkClientFrameSchema = z.union([
  downlinkHelloFrameSchema,
  relayEnvelopeFrameSchema,
]);
export type DownlinkClientFrame = z.infer<typeof downlinkClientFrameSchema>;

export const downlinkServerFrameSchema = z.union([
  downlinkReadyFrameSchema,
  relayServerErrorFrameSchema,
  relayEnvelopeFrameSchema,
]);
export type DownlinkServerFrame = z.infer<typeof downlinkServerFrameSchema>;

// ---- HTTP 契约 ----

/** POST /hosts/status：凭通行证批量查在线态；无有效通行证一律答 offline。 */
export const hostsStatusRequestSchema = z
  .array(
    z
      .object({
        hostId: z.string().min(1),
        deviceId: z.string().min(1),
        relayPass: z.string().min(1),
      })
      .strict()
  )
  .max(32);
export type HostsStatusRequest = z.infer<typeof hostsStatusRequestSchema>;

export const hostsStatusResponseSchema = z.array(
  z.object({ hostId: z.string().min(1), online: z.boolean() }).strict()
);
export type HostsStatusResponse = z.infer<typeof hostsStatusResponseSchema>;

/** POST /pair/relay 请求体：密封赎回（无 pairSecret 的人工输码路径直接 403）。 */
export const pairRelayRequestSchema = z
  .object({ hostId: z.string().min(1), sealed: relaySealedFrameSchema })
  .strict();
export type PairRelayRequest = z.infer<typeof pairRelayRequestSchema>;

/** POST /pair/relay 非 200 响应体 reason。 */
export const pairRelayFailureReasonSchema = z.enum([
  "host_offline",
  "rate_limited",
  "relay_error",
]);
export type PairRelayFailureReason = z.infer<
  typeof pairRelayFailureReasonSchema
>;
