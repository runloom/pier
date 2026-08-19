/**
 * Attention 系统通知文案（main 侧）。
 *
 * 分层（形态 B / OS 同源）：
 * - title：事件结果（扫一眼）
 * - body：身份上下文 + 下一步（可区分多实例）
 * - actionLabelKey：按事件语义的单一主操作
 *
 * waiting 与 terminal.agentStatus.waiting 语义对齐（「等待确认」），勿另造「等待你」。
 * 产品词：中文「需要你处理」/ 英文 Needs attention / 日语 対応が必要 / 韩语 처리 필요。
 */
import type { SupportedLocale } from "./i18n/locales.ts";

export type AttentionUiLocale = SupportedLocale;

export type AttentionNotificationStatus = "waiting" | "error" | "ready";

export interface AttentionNotificationCopy {
  actionLabelKey: string;
  body: string;
  title: string;
  titleKey: string;
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

const TITLE_KEYS = {
  waiting: "notificationsCenter.attention.waiting",
  ready: "notificationsCenter.attention.ready",
  error: "notificationsCenter.attention.error",
} as const;

const EMPTY_AGENT_LABEL: Record<AttentionUiLocale, string> = {
  en: "Agent",
  ja: "エージェント",
  ko: "에이전트",
  "zh-CN": "智能体",
};

const ATTENTION_TITLE: Record<
  AttentionUiLocale,
  Record<AttentionNotificationStatus, string>
> = {
  en: {
    error: "Agent ran into an error",
    ready: "Turn finished",
    waiting: "Needs attention",
  },
  ja: {
    error: "エージェントでエラーが発生しました",
    ready: "ターンが完了しました",
    waiting: "対応が必要",
  },
  ko: {
    error: "에이전트에 오류가 발생했습니다",
    ready: "턴이 끝났습니다",
    waiting: "처리 필요",
  },
  "zh-CN": {
    error: "智能体出错了",
    ready: "回合已完成",
    waiting: "需要你处理",
  },
};

const ATTENTION_BODY: Record<
  AttentionUiLocale,
  Record<AttentionNotificationStatus, string>
> = {
  en: {
    error: "Open the conversation to view the output",
    ready: "Ready for your next message",
    waiting: "Awaiting confirmation or your next step",
  },
  ja: {
    error: "会話を開いて出力を確認してください",
    ready: "次の入力ができます",
    waiting: "確認または続きの操作を待っています",
  },
  ko: {
    error: "대화를 열어 출력을 확인하세요",
    ready: "다음 입력을 할 수 있습니다",
    waiting: "확인하거나 다음 단계를 기다리는 중",
  },
  "zh-CN": {
    error: "打开对话查看输出",
    ready: "可以继续输入",
    waiting: "等待确认或继续",
  },
};

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
  return EMPTY_AGENT_LABEL[locale];
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
  return {
    actionLabelKey: attentionActionLabelKey(status),
    body: `${identity} — ${ATTENTION_BODY[locale][status]}`,
    title: ATTENTION_TITLE[locale][status],
    titleKey: TITLE_KEYS[status],
  };
}

/** 设置页「发送测试通知」文案；与业务通知同源本地化。 */
const TEST_COPY: Record<AttentionUiLocale, { body: string; title: string }> = {
  en: {
    body: "If you see this banner or Notification Center item, delivery works.",
    title: "Pier test notification",
  },
  ja: {
    body: "このバナーまたは通知センターの項目が見えれば、配信は成功しています。",
    title: "Pier テスト通知",
  },
  ko: {
    body: "이 배너 또는 알림 센터 항목이 보이면 전달이 정상입니다.",
    title: "Pier 테스트 알림",
  },
  "zh-CN": {
    body: "看到这条横幅或通知中心条目，说明系统通知投递正常。",
    title: "Pier 测试通知",
  },
};

export function formatAttentionTestNotificationCopy(
  locale: AttentionUiLocale
): { body: string; title: string } {
  return TEST_COPY[locale];
}
