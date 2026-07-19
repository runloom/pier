import type { PierEventBus } from "@main/app-core/event-bus.ts";
import {
  type AgentAttentionSettings,
  DEFAULT_AGENT_ATTENTION_SETTINGS,
} from "@shared/contracts/agent-attention.ts";

/**
 * Attention settings 进程内缓存。
 * boot 完成前三类事件全部强制关闭（enabled=false、turnNotifyMode=off、
 * enableErrorAttention=false），避免用默认值替用户做「通知」决定。
 * registerAgentAttention 负责 init；notification IPC 只读。
 */
let ready = false;
let cached: AgentAttentionSettings = {
  ...DEFAULT_AGENT_ATTENTION_SETTINGS,
  enabled: false,
};
let unsubscribePrefs: (() => void) | null = null;

export function getAgentAttentionSettingsCached(): AgentAttentionSettings {
  if (!ready) {
    return {
      ...cached,
      enabled: false,
      enableErrorAttention: false,
      turnNotifyMode: "off",
    };
  }
  // 返回拷贝：调用方变异不得污染进程级缓存。
  return { ...cached };
}

export function setAgentAttentionSettingsCacheForTests(
  settings: AgentAttentionSettings | null,
  options?: { ready?: boolean }
): void {
  if (settings === null) {
    ready = false;
    cached = {
      ...DEFAULT_AGENT_ATTENTION_SETTINGS,
      enabled: false,
    };
    return;
  }
  cached = { ...settings };
  ready = options?.ready ?? true;
}

export function initAgentAttentionSettingsCache(args: {
  eventBus?: PierEventBus;
  readPreferences: () => Promise<{ agentAttention: AgentAttentionSettings }>;
  onBootReadError?: (err: unknown) => void;
}): void {
  unsubscribePrefs?.();
  unsubscribePrefs = null;

  args
    .readPreferences()
    .then((prefs) => {
      // preferences.changed 可能先于 boot 读盘 resolve 到达；
      // 此时缓存已是更新快照，boot 结果不得回滚。
      if (ready) {
        return;
      }
      cached = { ...prefs.agentAttention };
      ready = true;
    })
    .catch((err: unknown) => {
      if (ready) {
        return;
      }
      args.onBootReadError?.(err);
      cached = { ...DEFAULT_AGENT_ATTENTION_SETTINGS };
      ready = true;
    });

  if (!args.eventBus) {
    return;
  }

  unsubscribePrefs = args.eventBus.subscribe((event) => {
    if (event.type !== "preferences.changed") {
      return;
    }
    if (!event.changedKeys.includes("agentAttention")) {
      return;
    }
    cached = { ...event.snapshot.agentAttention };
    ready = true;
  });
}
