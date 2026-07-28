import type { AgentHookEventPayload } from "@shared/contracts/agent-session.ts";

/**
 * 一条 transcript 行分类出的 provider 原生会话名。
 *
 * 与终态记录完全分开：标题不是状态，走独立回调，永不参与 turn 去重、
 * pending 回填或 stopAuthority。适配器接不到就不给，宿主静默降级。
 */
export interface TranscriptTitleRecord {
  /** 诊断用原生事件名（如 `claude.transcript.ai_title`）。 */
  nativeEvent: string;
  /** provider 会话号；缺席时为空串（退回「本 transcript 唯一 owner」）。 */
  sessionId: string;
  /** provider 给出的会话名原文（规范化与裁决在写入侧）。 */
  title: string;
}

/** provider 原生标题回调：带上归属面板的 hook 上下文（窗口 / 面板 / 会话号）。 */
export type TranscriptTitleListener = (input: {
  context: AgentHookEventPayload;
  record: TranscriptTitleRecord;
}) => void;

interface ProcessTranscriptTitleLineInput {
  classifyLine: (line: string) => TranscriptTitleRecord | null;
  lastTitleByScope: Map<string, string>;
  line: string;
  listener: TranscriptTitleListener;
  owners: Map<string, AgentHookEventPayload>;
}

/**
 * 只路由增量区间里的 provider 标题。首次绑定时回扫出的历史标题不可先占
 * 同秩槽位；是否处于增量区间由尾读核心决定。
 */
export function processTranscriptTitleLine({
  classifyLine,
  lastTitleByScope,
  line,
  listener,
  owners,
}: ProcessTranscriptTitleLineInput): void {
  const record = classifyLine(line);
  if (!record) {
    return;
  }
  const context = titleOwner(owners, record.sessionId);
  if (!context) {
    return;
  }
  const key = `${context.windowId}\0${context.panelId}`;
  // Claude 每回合都重写 ai-title；同值连发不必往下游递。
  if (lastTitleByScope.get(key) === record.title) {
    return;
  }
  lastTitleByScope.set(key, record.title);
  listener({ context, record });
}

/**
 * provider 给了会话号就按会话号认领；缺少或无法匹配会话号时，只允许唯一
 * owner 回退。多 owner 时证据不足，必须放弃，不能猜面板归属。
 */
function titleOwner(
  owners: Map<string, AgentHookEventPayload>,
  sessionId: string
): AgentHookEventPayload | undefined {
  if (sessionId) {
    for (const context of owners.values()) {
      if (context.sessionId === sessionId) {
        return context;
      }
    }
  }
  if (owners.size === 1) {
    return owners.values().next().value;
  }
  return;
}
