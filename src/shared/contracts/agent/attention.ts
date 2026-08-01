/**
 * Agent Attention 策略设置。
 * 持久化：preferences.agentAttention（须经 preferences-service PATCHABLE_KEYS）。
 * 系统通知权限探针类型见 `@shared/contracts/notification.ts`。
 */
import { z } from "zod";

export const AGENT_ATTENTION_COOLDOWN_MS = [60_000, 180_000, 600_000] as const;
export type AgentAttentionCooldownMs =
  (typeof AGENT_ATTENTION_COOLDOWN_MS)[number];

/** 内置音全量来自 vibe-kanban assets/sounds（Apache-2.0，见 NOTICE），顺序对齐上游枚举。 */
export const ATTENTION_SOUND_IDS = [
  "system",
  "abstract-sound1",
  "abstract-sound2",
  "abstract-sound3",
  "abstract-sound4",
  "cow-mooing",
  "phone-vibration",
  "rooster",
  "fahhhhh",
] as const;
export type AttentionSoundId = (typeof ATTENTION_SOUND_IDS)[number];

export const TURN_NOTIFY_MODES = ["off", "unfocused", "always"] as const;
export type TurnNotifyMode = (typeof TURN_NOTIFY_MODES)[number];

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
    /** 是否播放提示音；缺省 true，旧磁盘四字段对象升级时补齐。 */
    soundEnabled: z.boolean().default(true),
    /**
     * 提示音色；缺省 system，旧磁盘对象升级时补齐。
     * 历史 id（soft/clear/bright/bell 等）经 catch 回落 system，
     * 不得因音色目录演进触发整表 preferences 重置。
     */
    soundId: z.enum(ATTENTION_SOUND_IDS).default("system").catch("system"),
    /** 回合完成系统通知策略；缺省 unfocused，旧磁盘对象升级时补齐。 */
    turnNotifyMode: z.enum(TURN_NOTIFY_MODES).default("unfocused"),
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
  soundEnabled: true,
  soundId: "system",
  turnNotifyMode: "unfocused",
};

export const AGENT_ATTENTION_KIND = "agent.attention" as const;
export const AGENT_ATTENTION_TEST_KIND = "agent.attention.test" as const;
