import { z } from "zod";

/**
 * 系统级通知（OS 通知中心），与 renderer 内 toast 是两条独立通道。
 * Attention 必填 `kind: "agent.attention"` + `agentRef`；其它调用方勿占用该 kind。
 * 测试通知使用 `kind: "agent.attention.test"`，无业务 agentRef。
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

export const systemNotificationPermissionStatusSchema = z.enum([
  "unsupported",
  "denied",
  "unknown",
  "authorized",
]);

export type SystemNotificationPermissionStatus = z.infer<
  typeof systemNotificationPermissionStatusSchema
>;

export const systemNotificationPermissionSourceSchema = z.enum([
  "boot",
  "cached",
  "forced-probe",
  "attention-delivery",
]);

export type SystemNotificationPermissionSource = z.infer<
  typeof systemNotificationPermissionSourceSchema
>;

export const systemNotificationPermissionSnapshotSchema = z
  .object({
    observedAt: z.number().int().nonnegative(),
    source: systemNotificationPermissionSourceSchema,
    status: systemNotificationPermissionStatusSchema,
  })
  .strict();

export type SystemNotificationPermissionSnapshot = z.infer<
  typeof systemNotificationPermissionSnapshotSchema
>;

export const openSystemNotificationSettingsResultSchema = z
  .object({
    opened: z.boolean(),
    reason: z.string().optional(),
  })
  .strict();

export type OpenSystemNotificationSettingsResult = z.infer<
  typeof openSystemNotificationSettingsResultSchema
>;
