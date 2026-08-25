import { z } from "zod";
import type { pierCapabilitySchema } from "../permissions.ts";

/**
 * 沙箱轨能力桥协议 v1（Phase 2 realm 隔离）。
 *
 * 第三方插件运行在 opaque-origin sandbox iframe 中，与宿主的全部交互走
 * postMessage 帧。本文件是帧与方法注册表的单一契约来源。
 *
 * 信任锚：opaque origin 下 event.origin 为 "null" 不可作源校验，改用
 * per-iframe 一次性令牌 —— 宿主注入引导脚本，所有上行帧必须回带；
 * 校验失败一次即冻结该 iframe。见 spec：
 * docs/superpowers/specs/2026-08-24-plugin-realm-isolation-and-principal-auth-design.md
 */

export const BRIDGE_PROTOCOL_VERSION = 1;

/** 单帧字节上限（UTF-8 序列化后）。超限断链并记录操作日志。 */
export const BRIDGE_MAX_FRAME_BYTES = 2 * 1024 * 1024;
/** 单插件并发 call 上限。 */
export const BRIDGE_MAX_CONCURRENT_CALLS = 16;
/** call 超时，与现有外部加载超时同量级。 */
export const BRIDGE_CALL_TIMEOUT_MS = 10_000;

export const bridgeErrorCodeSchema = z.enum([
  /** manifest 权限或方法注册表拒绝。 */
  "denied",
  /** 方法未注册。 */
  "unknown_method",
  /** 响应超时。 */
  "timeout",
  /** 处理器内部错误。 */
  "internal_error",
  /** 帧校验失败（协议/令牌）。 */
  "protocol_error",
]);
export type BridgeErrorCode = z.infer<typeof bridgeErrorCodeSchema>;

const bridgeErrorSchema = z.object({
  code: bridgeErrorCodeSchema,
  message: z.string(),
});

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ])
);

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export const bridgeHelloFrameSchema = z.object({
  t: z.literal("hello"),
  proto: z.literal(BRIDGE_PROTOCOL_VERSION),
  token: z.string().min(1),
});

export const bridgeReadyFrameSchema = z.object({
  t: z.literal("ready"),
  proto: z.literal(BRIDGE_PROTOCOL_VERSION),
});

export const bridgeCallFrameSchema = z.object({
  t: z.literal("call"),
  id: z.number().int().positive(),
  method: z.string().min(1).max(128),
  params: jsonValueSchema,
  token: z.string().min(1),
});

export const bridgeResultOkFrameSchema = z.object({
  t: z.literal("result"),
  id: z.number().int().positive(),
  ok: z.literal(true),
  data: jsonValueSchema,
});

export const bridgeResultErrFrameSchema = z.object({
  t: z.literal("result"),
  id: z.number().int().positive(),
  ok: z.literal(false),
  error: bridgeErrorSchema,
});

export const bridgeResultFrameSchema = z.union([
  bridgeResultOkFrameSchema,
  bridgeResultErrFrameSchema,
]);

export const bridgeSubscribeFrameSchema = z.object({
  t: z.literal("subscribe"),
  channel: z.string().min(1).max(128),
  token: z.string().min(1),
});

export const bridgeEventFrameSchema = z.object({
  t: z.literal("event"),
  channel: z.string().min(1).max(128),
  payload: jsonValueSchema,
});

export const bridgeDisposeFrameSchema = z.object({ t: z.literal("dispose") });
/** 插件上行 ack 必须带 token；宿主下行拆除可省略。 */
export const bridgeDisposedFrameSchema = z.object({
  t: z.literal("disposed"),
  token: z.string().min(1).optional(),
});

/** 宿主 → 插件 与 插件 → 宿主 的全帧型。 */
export const bridgeFrameSchema = z.union([
  bridgeHelloFrameSchema,
  bridgeReadyFrameSchema,
  bridgeCallFrameSchema,
  bridgeResultOkFrameSchema,
  bridgeResultErrFrameSchema,
  bridgeSubscribeFrameSchema,
  bridgeEventFrameSchema,
  bridgeDisposeFrameSchema,
  bridgeDisposedFrameSchema,
]);

export type BridgeFrame = z.infer<typeof bridgeFrameSchema>;
export type BridgeCallFrame = z.infer<typeof bridgeCallFrameSchema>;
export type BridgeResultFrame = z.infer<typeof bridgeResultFrameSchema>;
export type BridgeError = z.infer<typeof bridgeErrorSchema>;

/**
 * 方法注册表条目：桥上每个可调用方法的静态能力声明。
 * deny-by-default —— 只有显式注册且 capability 满足的方法可派发。
 */
export interface BridgeMethodDescriptor {
  readonly capabilities: readonly z.infer<typeof pierCapabilitySchema>[];
  handler: (params: JsonValue) => Promise<JsonValue> | JsonValue;
}

export function serializeBridgeFrame(frame: BridgeFrame): string {
  return JSON.stringify(frame);
}

/** UTF-8 byte length of a serialized frame. */
export function bridgeFrameUtf8ByteLength(raw: string): number {
  return new TextEncoder().encode(raw).byteLength;
}

/** 解析上行帧；非法/超限返回 null（调用方按 protocol_error 处理）。 */
export function parseBridgeFrame(raw: unknown): BridgeFrame | null {
  if (typeof raw !== "string") return null;
  // JS string length is UTF-16 code units. ASCII is 1:1 with UTF-8; CJK is
  // 1 unit / 3 bytes, so length alone cannot enforce the 2 MiB UTF-8 cap.
  if (raw.length > BRIDGE_MAX_FRAME_BYTES) return null;
  if (
    raw.length * 3 > BRIDGE_MAX_FRAME_BYTES &&
    bridgeFrameUtf8ByteLength(raw) > BRIDGE_MAX_FRAME_BYTES
  ) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return bridgeFrameSchema.parse(parsed);
  } catch {
    return null;
  }
}
