/**
 * Agent Attention 策略设置。
 * 持久化：preferences.agentAttention（须经 preferences-service PATCHABLE_KEYS）。
 * 系统通知权限探针类型见 `@shared/contracts/notification.ts`。
 */
import { z } from "zod";

export const AGENT_ATTENTION_COOLDOWN_MS = [60_000, 180_000, 600_000] as const;
export type AgentAttentionCooldownMs =
  (typeof AGENT_ATTENTION_COOLDOWN_MS)[number];

export const agentAttentionSettingsSchema = z
  .object({
    /** 是否向 OS 投递系统通知；关后 Index/标题栏仍更新。 */
    enabled: z.boolean(),
    /** 进入 `error` 是否也发系统通知；默认 false（仅 waiting）。 */
    enableErrorAttention: z.boolean(),
    /** 目标 panel 已聚焦时是否抑制系统通知。 */
    suppressWhenFocused: z.boolean(),
    /** 同一 agentRef 冷却间隔（毫秒）。 */
    cooldownMs: z.union([
      z.literal(60_000),
      z.literal(180_000),
      z.literal(600_000),
    ]),
  })
  .strict();

export type AgentAttentionSettings = z.infer<
  typeof agentAttentionSettingsSchema
>;

export const DEFAULT_AGENT_ATTENTION_SETTINGS: AgentAttentionSettings = {
  enabled: true,
  enableErrorAttention: false,
  suppressWhenFocused: true,
  cooldownMs: 180_000,
};

export const AGENT_ATTENTION_KIND = "agent.attention" as const;
export const AGENT_ATTENTION_TEST_KIND = "agent.attention.test" as const;
