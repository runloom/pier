import {
  ATTENTION_BUILTIN_SOUND_IDS,
  type AttentionBuiltinSoundId,
} from "@shared/attention-sound-catalog.ts";
import { useEffect } from "react";
import { playAttentionSound } from "@/lib/attention/play-attention-sound.ts";

const BUILTIN_SOUND_IDS: ReadonlySet<AttentionBuiltinSoundId> = new Set(
  ATTENTION_BUILTIN_SOUND_IDS
);

/**
 * Attention 内置提示音桥 — 不渲染 UI。
 * 订阅 main 单窗 ATTENTION_SOUND_PLAY，经 HTMLAudio 播放。
 * 仅接受 catalog 内置 id，防越界 soundId。
 */
export function AttentionSoundBridge(): null {
  useEffect(() => {
    const api = window.pier?.notifications;
    if (!api?.onAttentionSoundPlay) {
      return;
    }
    return api.onAttentionSoundPlay(({ soundId }) => {
      if (!BUILTIN_SOUND_IDS.has(soundId as AttentionBuiltinSoundId)) {
        return;
      }
      playAttentionSound(soundId as AttentionBuiltinSoundId).catch(() => {
        // playAttentionSound 已 warn；吞掉避免 unhandled rejection
      });
    });
  }, []);

  return null;
}
