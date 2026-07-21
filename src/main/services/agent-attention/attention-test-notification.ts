import type { AgentAttentionSettings } from "@shared/contracts/agent-attention.ts";
import {
  decideNotificationAudio,
  type NotificationAudioDecision,
  toShowAudio,
} from "./notification-audio.ts";

export interface AttentionTestShowResult {
  shown: boolean;
}

export interface AttentionTestShowAudio {
  silent: boolean;
  sound?: "default";
}

/**
 * 设置页「测试通知」：与业务路径同一 decide；shown 后 force play（绕过 spacing）。
 */
export async function runAttentionTestNotification(args: {
  settings: Pick<AgentAttentionSettings, "soundEnabled" | "soundId">;
  showTest: (audio: AttentionTestShowAudio) => Promise<AttentionTestShowResult>;
  play: (args: { decision: NotificationAudioDecision; force: true }) => unknown;
}): Promise<AttentionTestShowResult> {
  const decision = decideNotificationAudio(args.settings);
  const result = await args.showTest(toShowAudio(decision));
  if (result.shown) {
    args.play({ decision, force: true });
  }
  return result;
}
