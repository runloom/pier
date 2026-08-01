/**
 * Agent 会话标题的 main 侧编排（产品 sessionTitle，≠ 终端 tab）。
 *
 * 终端 tab 标题终态对齐 Ghostty：OSC 0/2 → cwd basename，由 renderer
 * terminalPanelDescriptor 消费；本模块**不得**再为 tab 从 prompt 派生标题。
 *
 * 产品 sessionTitle 仅保留：
 *   provider 原生会话名   → agent 自己在 transcript 写下的名（Index / 改名初值）
 *   Stop / TurnCompleted  → 已落盘标题 hydrate 进 FA
 *   用户改名 IPC          → source=user（可覆盖 tab）
 *   SessionStart          → 按 sessionId 对账作用域
 *
 * PromptSubmit 不再写 sessionTitle（避免首条 prompt 脏串抢 tab / Index）。
 * 不进入 activityStatusForHookEvent；任何失败一律吞掉。
 */

import { normalizeAgentSessionTitle } from "@shared/agent-session-title/index.ts";
import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";
import type { ForegroundActivityAggregator } from "../../foreground-activity/types.ts";
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
  // PromptSubmit：不再从首条 prompt 派生产品标题（tab 走 OSC / cwd）。
  if (event.event === "PromptSubmit") {
    return;
  }
  if (HYDRATING_EVENTS.has(event.event)) {
    await hydrateFromDisk(aggregator, event);
  }
}

/**
 * provider 原生会话名（`provider` 秩）：agent 自己在 transcript 里写下的标题，
 * 直接采信，供 Index / 改名初值。**不驱动终端 tab**（tab 仍 OSC → cwd）。
 * 同秩不覆盖，因此 Claude 每回合重算 `ai-title` 只有第一条生效。
 * 接不到就是没有——不额外起进程、不花 token。
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

/** 已落盘标题回填进 FA（重启 / 面板恢复后 Index 与用户改名初值要能显示）。 */
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
