import type { AttentionBuiltinSoundId } from "@shared/attention-sound-catalog.ts";

let audio: HTMLAudioElement | null = null;
let inflight = false;

/**
 * 单例 HTMLAudio 播放内置 Attention 提示音。
 * 日志仅 soundId + error.name，禁止路径/agentRef/title/body。
 */
export async function playAttentionSound(
  soundId: AttentionBuiltinSoundId,
  opts?: { force?: boolean }
): Promise<void> {
  if (inflight && !opts?.force) {
    return;
  }
  inflight = true;
  try {
    audio ??= new Audio();
    audio.loop = false;
    audio.volume = 1;
    audio.src = `pier-asset://sounds/${soundId}.wav`;
    audio.currentTime = 0;
    await audio.play();
  } catch (err) {
    console.warn("[attention-sound] play failed", {
      soundId,
      name: err instanceof Error ? err.name : "unknown",
    });
    throw err;
  } finally {
    inflight = false;
  }
}
