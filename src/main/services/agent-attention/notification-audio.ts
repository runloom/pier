import type { AttentionBuiltinSoundId } from "@shared/attention-sound-catalog.ts";
import type { AgentAttentionSettings } from "@shared/contracts/agent-attention.ts";

export interface NotificationAudioDecision {
  /** 需要应用播音时的内置 id；否则 null */
  appSoundId: AttentionBuiltinSoundId | null;
  silent: boolean;
  /** darwin + system + soundEnabled 时为 "default"；否则 undefined */
  sound?: "default";
}

/** 业务路径全局播音最小间隔；试听/测试 force 可绕过。 */
export const ATTENTION_SOUND_SPACING_MS = 1000;

let lastBusinessPlayAtMs: number | null = null;

export function resetAttentionSoundPlaybackStateForTests(): void {
  lastBusinessPlayAtMs = null;
}

/** decision → showSystemNotification 的音频参数（exactOptionalPropertyTypes 安全）。 */
export function toShowAudio(decision: NotificationAudioDecision): {
  silent: boolean;
  sound?: "default";
} {
  return {
    silent: decision.silent,
    ...(decision.sound === undefined ? {} : { sound: decision.sound }),
  };
}

export function decideNotificationAudio(
  settings: Pick<AgentAttentionSettings, "soundEnabled" | "soundId">,
  platform: NodeJS.Platform = process.platform
): NotificationAudioDecision {
  if (!settings.soundEnabled) {
    return { silent: true, appSoundId: null };
  }
  if (settings.soundId === "system") {
    return platform === "darwin"
      ? { silent: false, sound: "default", appSoundId: null }
      : { silent: false, appSoundId: null };
  }
  return { silent: true, appSoundId: settings.soundId };
}

/**
 * shown:true 后尝试应用侧播音。仅当 decision.appSoundId 非空。
 * spacing 仅约束业务路径（force=false）。
 * 生产路径由 registerAgentAttention 注入 sendToWindow（单窗）。
 */
export function maybePlayAfterShown(args: {
  decision: NotificationAudioDecision;
  /** 业务 false；试听/测试 true */
  force?: boolean;
  now?: () => number;
  sendToWindow?: (payload: { soundId: string }) => boolean;
}):
  | "played"
  | "skipped-no-app-sound"
  | "skipped-spacing"
  | "skipped-no-window" {
  const {
    decision,
    force = false,
    now = () => Date.now(),
    sendToWindow,
  } = args;

  if (decision.appSoundId == null) {
    return "skipped-no-app-sound";
  }

  const ts = now();
  if (
    !force &&
    lastBusinessPlayAtMs !== null &&
    ts - lastBusinessPlayAtMs < ATTENTION_SOUND_SPACING_MS
  ) {
    return "skipped-spacing";
  }

  if (!sendToWindow) {
    return "skipped-no-window";
  }

  const sent = sendToWindow({ soundId: decision.appSoundId });
  if (!sent) {
    return "skipped-no-window";
  }

  // force 路径也刷新时间戳，避免紧随的业务 play 叠响
  lastBusinessPlayAtMs = ts;
  return "played";
}
