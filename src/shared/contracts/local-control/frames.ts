/**
 * pier.control/v2 帧 schema（传输金标准单一来源）。
 * 产品终态：唯一主体 cli-human（auth.method none）。
 * @see docs/superpowers/specs/2026-08-10-local-control-v1-v2-design.md
 */
import { z } from "zod";
import {
  LOCAL_CONTROL_API_VERSION,
  LOCAL_CONTROL_ERROR_CODES,
} from "./errors.ts";

const apiVersionSchema = z.literal(LOCAL_CONTROL_API_VERSION);
const nonEmpty = z.string().min(1);

export const localControlClientKindSchema = z.enum(["cli-human"]);
export type LocalControlClientKind = z.infer<
  typeof localControlClientKindSchema
>;

export const localControlAuthSchema = z.object({
  method: z.literal("none"),
});

export const localControlClientHelloSchema = z.object({
  apiVersion: apiVersionSchema,
  type: z.literal("client.hello"),
  requestId: nonEmpty,
  clientKind: localControlClientKindSchema,
  auth: localControlAuthSchema,
});
export type LocalControlClientHello = z.infer<
  typeof localControlClientHelloSchema
>;

export const localControlClientRequestSchema = z.object({
  apiVersion: apiVersionSchema,
  type: z.literal("request"),
  requestId: nonEmpty,
  op: nonEmpty,
  params: z.record(z.string(), z.unknown()).default({}),
  capabilityRef: z.unknown().optional(),
  effectKey: z.string().min(1).optional(),
  expectedBootId: z.string().min(1).optional(),
});
export type LocalControlClientRequest = z.infer<
  typeof localControlClientRequestSchema
>;

export const localControlClientSubscribeSchema = z.object({
  apiVersion: apiVersionSchema,
  type: z.literal("subscribe"),
  requestId: nonEmpty,
  stream: nonEmpty,
  after: z
    .object({
      bootId: nonEmpty.optional(),
      revision: z.number().int().nonnegative(),
      /** 与 control.watch 同构；跨 scope 禁止 resume */
      scope: nonEmpty.optional(),
    })
    .optional(),
});

export const localControlClientUnsubscribeSchema = z.object({
  apiVersion: apiVersionSchema,
  type: z.literal("unsubscribe"),
  requestId: nonEmpty,
  subscriptionId: nonEmpty,
});

export const localControlClientCancelSchema = z.object({
  apiVersion: apiVersionSchema,
  type: z.literal("cancel"),
  requestId: nonEmpty,
});

export const localControlClientFrameSchema = z.discriminatedUnion("type", [
  localControlClientHelloSchema,
  localControlClientRequestSchema,
  localControlClientSubscribeSchema,
  localControlClientUnsubscribeSchema,
  localControlClientCancelSchema,
]);
export type LocalControlClientFrame = z.infer<
  typeof localControlClientFrameSchema
>;

export const localControlCursorSchema = z.object({
  bootId: nonEmpty,
  revision: z.number().int().nonnegative(),
  scope: nonEmpty,
});

export const localControlResponseMetaSchema = z.object({
  effectRevision: z.number().int().nonnegative().optional(),
  cursor: localControlCursorSchema.optional(),
  truncated: z.boolean().optional(),
  attach: z.literal("reuse_same_operation").optional(),
});

export const localControlServerHelloSchema = z.object({
  apiVersion: apiVersionSchema,
  type: z.literal("server.hello"),
  requestId: nonEmpty,
  bootId: nonEmpty,
  serverTimeMs: z.number().int().nonnegative(),
  features: z.array(z.string()),
  principalRef: z.string().min(1).optional(),
});
export type LocalControlServerHello = z.infer<
  typeof localControlServerHelloSchema
>;

export const localControlErrorBodySchema = z.object({
  code: z.enum(LOCAL_CONTROL_ERROR_CODES),
  message: nonEmpty,
  details: z.unknown().optional(),
});

export const localControlServerResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    apiVersion: apiVersionSchema,
    type: z.literal("response"),
    requestId: nonEmpty,
    ok: z.literal(true),
    data: z.unknown(),
    meta: localControlResponseMetaSchema.optional(),
  }),
  z.object({
    apiVersion: apiVersionSchema,
    type: z.literal("response"),
    requestId: nonEmpty,
    ok: z.literal(false),
    error: localControlErrorBodySchema,
  }),
]);

export const localControlServerEventSchema = z.object({
  apiVersion: apiVersionSchema,
  type: z.literal("event"),
  subscriptionId: nonEmpty,
  bootId: nonEmpty,
  revision: z.number().int().nonnegative(),
  cursorScope: nonEmpty,
  mode: z.enum(["snapshot", "resume", "live"]),
  payload: z.unknown(),
});

export const localControlServerErrorSchema = z.object({
  apiVersion: apiVersionSchema,
  type: z.literal("server.error"),
  code: z.enum(LOCAL_CONTROL_ERROR_CODES),
  message: nonEmpty,
});
export type LocalControlServerError = z.infer<
  typeof localControlServerErrorSchema
>;

export const localControlServerFrameSchema = z.union([
  localControlServerHelloSchema,
  localControlServerResponseSchema,
  localControlServerEventSchema,
  localControlServerErrorSchema,
]);
export type LocalControlServerFrame = z.infer<
  typeof localControlServerFrameSchema
>;
