import { z } from "zod";

/**
 * 系统级通知（OS 通知中心），与 renderer 内 toast 是两条独立通道。
 * Attention 必填 `kind: "agent.attention"` + `agentRef`；其它调用方勿占用该 kind。
 */
export const systemNotificationRequestSchema = z
  .object({
    agentRef: z.string().min(1).optional(),
    body: z.string().optional(),
    kind: z.string().min(1).optional(),
    tag: z.string().min(1).optional(),
    title: z.string().min(1),
  })
  .strict();

export type SystemNotificationRequest = z.infer<
  typeof systemNotificationRequestSchema
>;

export const systemNotificationUnavailableReasonSchema = z.enum([
  "denied",
  "failed",
  "invalid",
  "unsupported",
]);

export type SystemNotificationUnavailableReason = z.infer<
  typeof systemNotificationUnavailableReasonSchema
>;

export const systemNotificationResultSchema = z
  .object({
    reason: systemNotificationUnavailableReasonSchema.optional(),
    shown: z.boolean(),
  })
  .strict();

export type SystemNotificationResult = z.infer<
  typeof systemNotificationResultSchema
>;
