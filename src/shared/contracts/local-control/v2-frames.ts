/**
 * pier.control/v2 帧 schema（传输金标准单一来源）。
 * @see docs/superpowers/specs/2026-08-10-local-control-v1-v2-design.md
 */
import { z } from "zod";
import {
  LOCAL_CONTROL_V2_API_VERSION,
  LOCAL_CONTROL_V2_ERROR_CODES,
} from "./v2-errors.ts";

const apiVersionSchema = z.literal(LOCAL_CONTROL_V2_API_VERSION);
const nonEmpty = z.string().min(1);

export const localControlV2ClientKindSchema = z.enum([
  "agent",
  "cli-human",
  "external",
]);
export type LocalControlV2ClientKind = z.infer<
  typeof localControlV2ClientKindSchema
>;

export const localControlV2AuthSchema = z.discriminatedUnion("method", [
  z.object({
    method: z.literal("agent-credential"),
    /** 公开句柄，不可单独充当持有证明 */
    credentialId: nonEmpty,
    /** 高熵 secret，必须与 store 中材料一致 */
    secret: nonEmpty,
  }),
  z.object({
    method: z.literal("none"),
  }),
  z.object({
    method: z.literal("external-grant"),
    grantId: nonEmpty,
    publicKey: nonEmpty,
  }),
]);

export const localControlV2ClientHelloSchema = z.object({
  apiVersion: apiVersionSchema,
  type: z.literal("client.hello"),
  requestId: nonEmpty,
  clientKind: localControlV2ClientKindSchema,
  auth: localControlV2AuthSchema,
});
export type LocalControlV2ClientHello = z.infer<
  typeof localControlV2ClientHelloSchema
>;

export const localControlV2ClientAuthProofSchema = z.object({
  apiVersion: apiVersionSchema,
  type: z.literal("client.auth-proof"),
  requestId: nonEmpty,
  challengeId: nonEmpty,
  signature: nonEmpty,
});

export const localControlV2ClientRequestSchema = z.object({
  apiVersion: apiVersionSchema,
  type: z.literal("request"),
  requestId: nonEmpty,
  op: nonEmpty,
  params: z.record(z.string(), z.unknown()).default({}),
  capabilityRef: z.unknown().optional(),
  effectKey: z.string().min(1).optional(),
  expectedBootId: z.string().min(1).optional(),
});
export type LocalControlV2ClientRequest = z.infer<
  typeof localControlV2ClientRequestSchema
>;

export const localControlV2ClientSubscribeSchema = z.object({
  apiVersion: apiVersionSchema,
  type: z.literal("subscribe"),
  requestId: nonEmpty,
  stream: nonEmpty,
  after: z
    .object({
      bootId: nonEmpty,
      revision: z.number().int().nonnegative(),
    })
    .optional(),
});

export const localControlV2ClientUnsubscribeSchema = z.object({
  apiVersion: apiVersionSchema,
  type: z.literal("unsubscribe"),
  requestId: nonEmpty,
  subscriptionId: nonEmpty,
});

export const localControlV2ClientCancelSchema = z.object({
  apiVersion: apiVersionSchema,
  type: z.literal("cancel"),
  requestId: nonEmpty,
});

export const localControlV2ClientFrameSchema = z.discriminatedUnion("type", [
  localControlV2ClientHelloSchema,
  localControlV2ClientAuthProofSchema,
  localControlV2ClientRequestSchema,
  localControlV2ClientSubscribeSchema,
  localControlV2ClientUnsubscribeSchema,
  localControlV2ClientCancelSchema,
]);
export type LocalControlV2ClientFrame = z.infer<
  typeof localControlV2ClientFrameSchema
>;

export const localControlV2CursorSchema = z.object({
  bootId: nonEmpty,
  revision: z.number().int().nonnegative(),
  scope: nonEmpty,
});

export const localControlV2ResponseMetaSchema = z.object({
  effectRevision: z.number().int().nonnegative().optional(),
  cursor: localControlV2CursorSchema.optional(),
  truncated: z.boolean().optional(),
  attach: z.literal("reuse_same_operation").optional(),
});

export const localControlV2ServerHelloSchema = z.object({
  apiVersion: apiVersionSchema,
  type: z.literal("server.hello"),
  requestId: nonEmpty,
  bootId: nonEmpty,
  serverTimeMs: z.number().int().nonnegative(),
  features: z.array(z.string()),
  principalRef: z.string().min(1).optional(),
});
export type LocalControlV2ServerHello = z.infer<
  typeof localControlV2ServerHelloSchema
>;

export const localControlV2ServerChallengeSchema = z.object({
  apiVersion: apiVersionSchema,
  type: z.literal("server.challenge"),
  requestId: nonEmpty,
  challengeId: nonEmpty,
  purpose: z.enum(["request-grant", "use-grant"]),
  nonce: nonEmpty,
  issuedAtMs: z.number().int().nonnegative(),
  expiresAtMs: z.number().int().nonnegative(),
  bootId: nonEmpty,
});

export const localControlV2ErrorBodySchema = z.object({
  code: z.enum(LOCAL_CONTROL_V2_ERROR_CODES),
  message: nonEmpty,
  details: z.unknown().optional(),
});

export const localControlV2ServerResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    apiVersion: apiVersionSchema,
    type: z.literal("response"),
    requestId: nonEmpty,
    ok: z.literal(true),
    data: z.unknown(),
    meta: localControlV2ResponseMetaSchema.optional(),
  }),
  z.object({
    apiVersion: apiVersionSchema,
    type: z.literal("response"),
    requestId: nonEmpty,
    ok: z.literal(false),
    error: localControlV2ErrorBodySchema,
  }),
]);

export const localControlV2ServerEventSchema = z.object({
  apiVersion: apiVersionSchema,
  type: z.literal("event"),
  subscriptionId: nonEmpty,
  bootId: nonEmpty,
  revision: z.number().int().nonnegative(),
  cursorScope: nonEmpty,
  mode: z.enum(["snapshot", "resume", "live"]),
  payload: z.unknown(),
});

export const localControlV2ServerErrorSchema = z.object({
  apiVersion: apiVersionSchema,
  type: z.literal("server.error"),
  code: z.enum(LOCAL_CONTROL_V2_ERROR_CODES),
  message: nonEmpty,
});
export type LocalControlV2ServerError = z.infer<
  typeof localControlV2ServerErrorSchema
>;

export const localControlV2ServerFrameSchema = z.union([
  localControlV2ServerHelloSchema,
  localControlV2ServerChallengeSchema,
  localControlV2ServerResponseSchema,
  localControlV2ServerEventSchema,
  localControlV2ServerErrorSchema,
]);
export type LocalControlV2ServerFrame = z.infer<
  typeof localControlV2ServerFrameSchema
>;
