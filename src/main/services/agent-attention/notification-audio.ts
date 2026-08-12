import type { AttentionBuiltinSoundId } from "@shared/attention-sound-catalog.ts";
import type { AgentAttentionSettings } from "@shared/contracts/agent/attention.ts";

export interface NotificationAudioDecision {
  /** 需要应用播音时的内置 id；否则 null */
  appSoundId: AttentionBuiltinSoundId | null;
  silent: boolean;
  /** darwin + system + soundEnabled 时为 "default"；否则 undefined */
  sound?: "default";
  /**
   * `soundId=system` 且 soundEnabled：OS 路径用横幅默认音；
   * toast 路径用 {@link TOAST_SYSTEM_SOUND_FALLBACK}（见 resolveInterruptAppSoundId）。
   * 禁止用 `silent===false && appSoundId==null` 反推 system。
   */
  usesOsDefaultTone: boolean;
}

/** 打断播音通道：与 toast / OS 互斥投递对齐。 */
export type InterruptSoundChannel = "os" | "toast";

/**
 * toast 无系统横幅音轨时，`soundId=system` 的应用内回退音色。
 * OS 路径仍走 Notification 默认音，不经过此 id。
 */
export const TOAST_SYSTEM_SOUND_FALLBACK: AttentionBuiltinSoundId =
  "abstract-sound1";

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
    return { silent: true, appSoundId: null, usesOsDefaultTone: false };
  }
  if (settings.soundId === "system") {
    return platform === "darwin"
      ? {
          silent: false,
          sound: "default",
          appSoundId: null,
          usesOsDefaultTone: true,
        }
      : { silent: false, appSoundId: null, usesOsDefaultTone: true };
  }
  return {
    silent: true,
    appSoundId: settings.soundId,
    usesOsDefaultTone: false,
  };
}

/**
 * 解析打断通道上需要应用侧播放的内置 id。
 * - 内置音色：两通道相同
 * - system（usesOsDefaultTone）：OS 交给横幅默认音（null）；toast 用 fallback
 * - soundEnabled=false：null
 */
export function resolveInterruptAppSoundId(
  decision: NotificationAudioDecision,
  channel: InterruptSoundChannel
): AttentionBuiltinSoundId | null {
  if (decision.appSoundId != null) {
    return decision.appSoundId;
  }
  if (channel === "toast" && decision.usesOsDefaultTone) {
    return TOAST_SYSTEM_SOUND_FALLBACK;
  }
  return null;
}

export type AttentionSoundPlayResult =
  | "played"
  | "skipped-no-app-sound"
  | "skipped-spacing"
  | "skipped-no-window";

/**
 * 应用侧播音（内置 id）。spacing 仅约束业务路径（force=false）。
 * 生产路径注入 sendToWindow（单窗）。
 */
export function maybePlayAfterShown(args: {
  decision: NotificationAudioDecision;
  /** 业务 false；试听/测试 true */
  force?: boolean;
  now?: () => number;
  sendToWindow?: (payload: { soundId: string }) => boolean;
}): AttentionSoundPlayResult {
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

/**
 * 打断成功后尝试应用侧播音（toast 投递成功 / OS shown）。
 * 与通道解析同一套 decision；system@toast 走内置回退。
 */
export function maybePlayInterruptSound(args: {
  channel: InterruptSoundChannel;
  decision: NotificationAudioDecision;
  force?: boolean;
  now?: () => number;
  sendToWindow?: (payload: { soundId: string }) => boolean;
}): AttentionSoundPlayResult {
  const appSoundId = resolveInterruptAppSoundId(args.decision, args.channel);
  return maybePlayAfterShown({
    decision: { ...args.decision, appSoundId },
    ...(args.force === undefined ? {} : { force: args.force }),
    ...(args.now === undefined ? {} : { now: args.now }),
    ...(args.sendToWindow === undefined
      ? {}
      : { sendToWindow: args.sendToWindow }),
  });
}
