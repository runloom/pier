import type { AttentionSoundId } from "@shared/contracts/agent-attention.ts";

export const ATTENTION_BUILTIN_SOUND_IDS = [
  "abstract-sound1",
  "abstract-sound2",
  "abstract-sound3",
  "abstract-sound4",
  "cow-mooing",
  "phone-vibration",
  "rooster",
  "fahhhhh",
] as const;

/** 内置音 id（不含 system）；音色选择 / 预览 / 播音端口共用。 */
export type AttentionBuiltinSoundId =
  (typeof ATTENTION_BUILTIN_SOUND_IDS)[number];

export function attentionSoundFileName(id: AttentionBuiltinSoundId): string {
  return `${id}.wav`;
}

export function isPreviewableAttentionSoundId(
  id: AttentionSoundId
): id is AttentionBuiltinSoundId {
  return id !== "system";
}
