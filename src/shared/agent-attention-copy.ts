/**
 * Attention 系统通知文案（main 侧）。
 *
 * 分层（形态 B / OS 同源）：
 * - title：事件结果（扫一眼）
 * - body：身份上下文 + 下一步（可区分多实例）
 * - actionLabelKey：按事件语义的单一主操作
 *
 * waiting 与 terminal.agentStatus.waiting 语义对齐（「等待确认」），勿另造「等待你」。
 * 产品词：中文「需要你处理」/ 英文 "Needs you"（与 Index / 设置 / 工作台一致）。
 */
export type AttentionUiLocale = "en" | "zh-CN";

export type AttentionNotificationStatus = "waiting" | "error" | "ready";

export interface AttentionNotificationCopy {
  actionLabelKey: string;
  body: string;
  title: string;
}

export interface FormatAttentionNotificationInput {
  agentLabel: string;
  cwd?: string | null;
  /** 项目根；只取叶子目录名展示。优先于 cwd。 */
  projectRootPath?: string | null;
  /** 产品会话名（≠ 终端 OSC tab）。 */
  sessionTitle?: string | null;
  status: AttentionNotificationStatus | string;
}

const MAX_IDENTITY_SEGMENT = 40;

const ACTION_LABEL_KEYS = {
  waiting: "notificationsCenter.action.goToAgent",
  ready: "notificationsCenter.action.openAgent",
  error: "notificationsCenter.action.viewAgentOutput",
} as const;

/** POSIX / Windows 路径叶子名；空或根路径返回 undefined。 */
export function attentionPathLeaf(
  path: string | null | undefined
): string | undefined {
  if (path == null) {
    return;
  }
  const raw = path.trim();
  if (raw === "" || raw === "/" || raw === "\\") {
    return;
  }
  const trimmed =
    (raw.endsWith("/") || raw.endsWith("\\")) && raw.length > 1
      ? raw.slice(0, -1)
      : raw;
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  const leaf = idx === -1 ? trimmed : trimmed.slice(idx + 1);
  if (!leaf || leaf === "/" || leaf === "\\") {
    return;
  }
  return leaf;
}

function clipSegment(value: string, max = MAX_IDENTITY_SEGMENT): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) {
    return collapsed;
  }
  return `${collapsed.slice(0, max - 1)}…`;
}

function normalizeStatus(status: string): AttentionNotificationStatus {
  if (status === "error" || status === "ready" || status === "waiting") {
    return status;
  }
  return "waiting";
}

function emptyAgentLabelFallback(locale: AttentionUiLocale): string {
  return locale === "zh-CN" ? "智能体" : "Agent";
}

/**
 * 身份段：agentLabel · sessionTitle? · locationLeaf?
 * location 优先 projectRootPath 叶子，否则 cwd 叶子；与 sessionTitle 去重。
 */
export function formatAttentionIdentity(
  input: {
    agentLabel: string;
    sessionTitle?: string | null;
    projectRootPath?: string | null;
    cwd?: string | null;
  },
  locale: AttentionUiLocale = "en"
): string {
  const label = input.agentLabel.trim() || emptyAgentLabelFallback(locale);
  const parts: string[] = [clipSegment(label)];
  const session = input.sessionTitle?.trim();
  if (session) {
    parts.push(clipSegment(session));
  }
  const location =
    attentionPathLeaf(input.projectRootPath) ?? attentionPathLeaf(input.cwd);
  if (location) {
    const clipped = clipSegment(location);
    // 会话名已是同名叶子时不再重复。
    if (!parts.some((p) => p === clipped)) {
      parts.push(clipped);
    }
  }
  return parts.join(" · ");
}

export function attentionActionLabelKey(
  status: AttentionNotificationStatus | string
): string {
  return ACTION_LABEL_KEYS[normalizeStatus(status)];
}

export function formatAttentionNotificationCopy(
  input: FormatAttentionNotificationInput,
  locale: AttentionUiLocale
): AttentionNotificationCopy {
  const status = normalizeStatus(input.status);
  const identity = formatAttentionIdentity(input, locale);
  const actionLabelKey = attentionActionLabelKey(status);

  if (locale === "zh-CN") {
    if (status === "error") {
      return {
        actionLabelKey,
        body: `${identity} — 打开对话查看输出`,
        title: "智能体出错了",
      };
    }
    if (status === "ready") {
      return {
        actionLabelKey,
        body: `${identity} — 可以继续输入`,
        title: "回合已完成",
      };
    }
    return {
      actionLabelKey,
      body: `${identity} — 等待确认或继续`,
      title: "需要你处理",
    };
  }

  if (status === "error") {
    return {
      actionLabelKey,
      body: `${identity} — Open the conversation to view the output`,
      title: "Agent ran into an error",
    };
  }
  if (status === "ready") {
    return {
      actionLabelKey,
      body: `${identity} — Ready for your next message`,
      title: "Turn finished",
    };
  }
  return {
    actionLabelKey,
    body: `${identity} — Awaiting confirmation or your next step`,
    title: "Needs you",
  };
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
