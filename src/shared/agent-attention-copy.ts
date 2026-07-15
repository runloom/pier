/**
 * Attention 系统通知文案（main 侧）。与 terminal.agentStatus.waiting/error 语义对齐：
 * waiting → 等待确认 / Awaiting confirmation；勿另造「等待你」。
 */
export type AttentionUiLocale = "en" | "zh-CN";

export function formatAttentionNotificationCopy(
  input: { agentLabel: string; status: "waiting" | "error" | string },
  locale: AttentionUiLocale
): { body: string; title: string } {
  const label = input.agentLabel;
  if (locale === "zh-CN") {
    if (input.status === "error") {
      return { body: `${label} 出错了`, title: label };
    }
    return { body: `${label} 等待确认`, title: label };
  }
  if (input.status === "error") {
    return { body: `${label} reported an error`, title: label };
  }
  return { body: `${label} is awaiting confirmation`, title: label };
}
