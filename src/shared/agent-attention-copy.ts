/**
 * Attention 系统通知文案（main 侧）。与 terminal.agentStatus.waiting/error 语义对齐：
 * waiting → 等待确认 / Awaiting confirmation；勿另造「等待你」。
 * ready → 回合已完成 / finished a turn。
 */
export type AttentionUiLocale = "en" | "zh-CN";

export function formatAttentionNotificationCopy(
  input: { agentLabel: string; status: "waiting" | "error" | "ready" | string },
  locale: AttentionUiLocale
): { body: string; title: string } {
  const label = input.agentLabel;
  if (locale === "zh-CN") {
    if (input.status === "error") {
      return { body: `${label} 出错了`, title: label };
    }
    if (input.status === "ready") {
      return { body: `${label} 回合已完成`, title: label };
    }
    return { body: `${label} 等待确认`, title: label };
  }
  if (input.status === "error") {
    return { body: `${label} reported an error`, title: label };
  }
  if (input.status === "ready") {
    return { body: `${label} finished a turn`, title: label };
  }
  return { body: `${label} is awaiting confirmation`, title: label };
}

/** 设置页「发送测试通知」文案；与业务通知同源本地化。 */
export function formatAttentionTestNotificationCopy(
  locale: AttentionUiLocale
): { body: string; title: string } {
  if (locale === "zh-CN") {
    return {
      body: "看到这条横幅或通知中心条目，说明系统通知投递正常。",
      title: "Pier 测试通知",
    };
  }
  return {
    body: "If you see this banner or Notification Center item, delivery works.",
    title: "Pier test notification",
  };
}
