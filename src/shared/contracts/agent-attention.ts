/**
 * Agent Attention 策略设置（P1.5）。
 * 默认可硬编码；设置页持久化可 follow-up。
 */
export interface AgentAttentionSettings {
  /** 同一 agentRef 冷却间隔（毫秒）。 */
  cooldownMs: number;
  /** 进入 `error` 是否也发系统通知；默认 false（仅 waiting）。 */
  enableErrorAttention: boolean;
}

export const DEFAULT_AGENT_ATTENTION_SETTINGS: AgentAttentionSettings = {
  cooldownMs: 180_000,
  enableErrorAttention: false,
};

export const AGENT_ATTENTION_KIND = "agent.attention" as const;
