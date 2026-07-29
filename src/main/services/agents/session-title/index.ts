/**
 * Agent 会话标题的 main 侧编排。
 *
 * 三层，无模型参与（本进程不为标题调任何模型）：
 *   PromptSubmit          → 由首条 prompt 确定性派生（纯函数，即时，离线可用）
 *   provider 原生会话名   → agent 自己已经算好的标题，从 transcript 读出来直接用
 *   Stop / TurnCompleted  → 只把已落盘标题回填进 FA（hydrate），不再改写
 *   之后                  → 只有用户改名能再动
 *
 * 不做模型精修：标题是尽力而为的可读性信号，不是身份。身份由 agentId +
 * 项目路径 + panelId + actorHint 承担（见 contracts/foreground-activity.ts），
 * 任何「猜得更准一点」的启发式都不能提升身份的确定性，只会引入不可复现的
 * 结果和额外一次模型调用。
 *
 * 不进入 activityStatusForHookEvent；任何失败一律吞掉。
 */

import {
  deriveAgentSessionTitleFromPrompt,
  MAX_PROMPT_SNIPPET_LENGTH,
  normalizeAgentSessionTitle,
} from "@shared/agent-session-title/index.ts";
import type { AgentHookEventPayload } from "@shared/contracts/agent-session.ts";
import type { ForegroundActivityAggregator } from "../../foreground-activity/types.ts";
import { installAgentHooksStack } from "../integrations/registry.ts";
import { logTitleTier } from "./log.ts";
import {
  readPanelSession,
  reconcileAgentSessionTitleScope,
  writeAgentSessionTitle,
} from "./write.ts";

export { writeAgentSessionTitle } from "./write.ts";

const HYDRATING_EVENTS = new Set(["Stop", "TurnCompleted"]);

export async function applyAgentSessionTitleFromHookEvent(args: {
  aggregator: ForegroundActivityAggregator;
  event: AgentHookEventPayload;
}): Promise<void> {
  const { aggregator, event } = args;
  if (event.event === "SessionStart") {
    await reconcileAgentSessionTitleScope({
      aggregator,
      panelId: event.panelId,
      ...(event.sessionId?.trim() ? { sessionId: event.sessionId.trim() } : {}),
      windowId: event.windowId,
    });
    return;
  }
  if (event.event === "PromptSubmit") {
    await deriveFromPromptSubmit(aggregator, event);
    return;
  }
  if (HYDRATING_EVENTS.has(event.event)) {
    await hydrateFromDisk(aggregator, event);
  }
}

/**
 * provider 原生会话名（`provider` 秩）：agent 自己在 transcript 里写下的标题，
 * 直接采信。秩高于 prompt 派生、低于用户改名；同秩不覆盖，因此 Claude 每回合
 * 重算 `ai-title` 也只有第一条生效，标题不会抖。
 *
 * 接不到就是没有——不额外起进程、不花 token、不影响 prompt 地板。
 */
export async function applyProviderAgentSessionTitle(args: {
  aggregator: ForegroundActivityAggregator;
  agentId?: string;
  /** 原生记录标识；真机上「标题没跟上」时用来区分是哪条记录被拒。 */
  nativeEvent?: string;
  panelId: string;
  sessionId?: string;
  title: string;
  windowId: string;
}): Promise<void> {
  const normalized = normalizeAgentSessionTitle(args.title);
  const logCtx = {
    ...(args.agentId ? { agentId: args.agentId } : {}),
    ...(args.nativeEvent ? { nativeEvent: args.nativeEvent } : {}),
    panelId: args.panelId,
    tier: "provider" as const,
  };
  if (!normalized) {
    logTitleTier({ ...logCtx, outcome: "empty" });
    return;
  }
  const written = await writeAgentSessionTitle({
    aggregator: args.aggregator,
    panelId: args.panelId,
    source: "provider",
    ...(args.sessionId ? { sessionId: args.sessionId } : {}),
    title: normalized,
    windowId: args.windowId,
  });
  logTitleTier({
    ...logCtx,
    outcome: written.applied ? "applied" : "rejected-rank",
  });
}

function promptSnippetFromMetadata(
  metadataBase64: string | null | undefined
): string | undefined {
  if (!metadataBase64) {
    return;
  }
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(metadataBase64, "base64").toString("utf8")
    );
    if (!(parsed && typeof parsed === "object" && !Array.isArray(parsed))) {
      return;
    }
    const record = parsed as Record<string, unknown>;
    for (const key of ["promptSnippet", "prompt_snippet", "prompt"] as const) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) {
        return value.slice(0, MAX_PROMPT_SNIPPET_LENGTH);
      }
    }
  } catch {
    return;
  }
}

export function promptSnippetForAgentSessionTitle(
  event: AgentHookEventPayload
): string | undefined {
  if ("promptSnippet" in event && event.promptSnippet?.trim()) {
    return event.promptSnippet.slice(0, MAX_PROMPT_SNIPPET_LENGTH);
  }
  return promptSnippetFromMetadata(event.metadataBase64);
}

let hooksSelfHealInFlight: Promise<void> | null = null;

/**
 * PromptSubmit 无文案时重装 hooks 栈一次（运行时 + 全局配置）。
 * 旧实例可能盖掉 extract 脚本或全局条目；栈安装只前进、内容相同不落盘。
 *
 * 这是诊断 / 自愈路径，不是提升标题质量的手段：装不上就是没标题，
 * 占位符照常显示，身份不受影响。
 */
function selfHealAgentHooksIfNeeded(): void {
  if (hooksSelfHealInFlight) {
    return;
  }
  hooksSelfHealInFlight = installAgentHooksStack()
    .catch(() => undefined)
    .finally(() => {
      hooksSelfHealInFlight = null;
    });
}

async function deriveFromPromptSubmit(
  aggregator: ForegroundActivityAggregator,
  event: AgentHookEventPayload
): Promise<void> {
  const snippet = promptSnippetForAgentSessionTitle(event);
  if (!snippet) {
    selfHealAgentHooksIfNeeded();
    logTitleTier({ outcome: "empty", panelId: event.panelId, tier: "prompt" });
    return;
  }
  const derived = deriveAgentSessionTitleFromPrompt(snippet);
  if (!derived) {
    logTitleTier({ outcome: "empty", panelId: event.panelId, tier: "prompt" });
    return;
  }
  const written = await writeAgentSessionTitle({
    aggregator,
    panelId: event.panelId,
    source: "prompt",
    ...(event.sessionId?.trim() ? { sessionId: event.sessionId.trim() } : {}),
    title: derived,
    windowId: event.windowId,
  });
  logTitleTier({
    outcome: written.applied ? "applied" : "rejected-rank",
    panelId: event.panelId,
    tier: "prompt",
  });
}

/** 已落盘标题回填进 FA（重启 / 面板恢复后 tab 与列表要能显示出来）。 */
async function hydrateFromDisk(
  aggregator: ForegroundActivityAggregator,
  event: AgentHookEventPayload
): Promise<void> {
  const session = await readPanelSession(event.windowId, event.panelId);
  const title = session?.sessionTitle?.trim();
  const source = session?.sessionTitleSource;
  if (title && source) {
    aggregator.hydrateAgentSessionTitle(event.windowId, event.panelId, {
      source,
      ...(session.sessionTitleSessionId
        ? { sessionId: session.sessionTitleSessionId }
        : {}),
      title,
    });
  }
}
