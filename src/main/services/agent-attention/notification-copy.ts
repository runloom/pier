import {
  type AttentionUiLocale,
  formatAttentionNotificationCopy as formatShared,
} from "@shared/agent-attention-copy.ts";
import { getAgentCatalogEntry } from "@shared/agent-catalog.ts";
import type { ForegroundActivity } from "@shared/contracts/foreground-activity.ts";

export type { AttentionUiLocale } from "@shared/agent-attention-copy.ts";

export function formatAttentionNotificationCopy(
  activity: Extract<ForegroundActivity, { kind: "agent" }>,
  locale: AttentionUiLocale
): { body: string; title: string } {
  const agentLabel =
    getAgentCatalogEntry(activity.agentId)?.label ?? activity.agentId;
  // 调用方已保证进入 waiting/error；其它状态不应走到通知文案。
  const status =
    activity.status === "error" || activity.status === "waiting"
      ? activity.status
      : "waiting";
  return formatShared({ agentLabel, status }, locale);
}
