/**
 * Agent 会话标题的 main 侧编排。
 *
 * 三层收敛后冻结：
 *   PromptSubmit  → T1 规则派生（纯函数，即时，离线可用）
 *   首轮 Stop     → T2 模型精修（信号 = 首条 prompt + 本轮改动文件）
 *   之后          → 只有用户改名能再动
 *
 * T2 放在 Stop 而不是 PromptSubmit：那一刻才拿得到「agent 实际改了哪些
 * 文件」，且 T1 已经在 tab 上了，慢一点无所谓。
 *
 * 不进入 activityStatusForHookEvent；任何失败一律吞掉。
 */

import {
  deriveAgentSessionTitleFromPrompt,
  MAX_PROMPT_SNIPPET_LENGTH,
} from "@shared/agent-session-title/index.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import type { AgentHookEventPayload } from "@shared/contracts/agent-session.ts";
import type { ForegroundActivityAggregator } from "../../foreground-activity/types.ts";
import { installAllAgentHooks } from "../integrations/registry.ts";
import { logTitleTier } from "./log.ts";
import { refineAgentSessionTitle } from "./refine-one-shot.ts";
import { agentSessionTitleDeps } from "./refine-port.ts";
import {
  beginRefine,
  endRefine,
  firstPromptFor,
  forgetPanel,
  panelTitleKey,
  rememberFirstPrompt,
} from "./refine-scheduler.ts";
import { readPanelSession, writeAgentSessionTitle } from "./write.ts";

export {
  type AgentSessionTitleDeps,
  registerAgentSessionTitleDeps,
  type TitleGitSignals,
} from "./refine-port.ts";
export { writeAgentSessionTitle } from "./write.ts";

const HYDRATING_EVENTS = new Set(["Stop", "TurnCompleted", "SessionStart"]);
const TURN_SETTLED_EVENTS = new Set(["Stop", "TurnCompleted"]);

/** 面板关闭：丢掉首条 prompt 记忆与尝试计数。 */
export function forgetPanelTitleState(windowId: string, panelId: string): void {
  forgetPanel(panelTitleKey(windowId, panelId));
}

export async function applyAgentSessionTitleFromHookEvent(args: {
  aggregator: ForegroundActivityAggregator;
  event: AgentHookEventPayload;
}): Promise<void> {
  const { aggregator, event } = args;
  if (event.event === "PromptSubmit") {
    await deriveFromPromptSubmit(aggregator, event);
    return;
  }
  if (HYDRATING_EVENTS.has(event.event)) {
    await onTurnSettled(aggregator, event);
  }
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

function promptSnippetOf(event: AgentHookEventPayload): string | undefined {
  if ("v" in event && event.v === 2 && event.promptSnippet?.trim()) {
    return event.promptSnippet.slice(0, MAX_PROMPT_SNIPPET_LENGTH);
  }
  return promptSnippetFromMetadata(event.metadataBase64);
}

let hooksSelfHealInFlight: Promise<void> | null = null;

/** PromptSubmit 无文案时重装 hooks 一次（旧 worktree 可能盖掉 prompt 提取）。 */
function selfHealAgentHooksIfNeeded(): void {
  if (hooksSelfHealInFlight) {
    return;
  }
  hooksSelfHealInFlight = installAllAgentHooks()
    .catch(() => undefined)
    .finally(() => {
      hooksSelfHealInFlight = null;
    });
}

async function deriveFromPromptSubmit(
  aggregator: ForegroundActivityAggregator,
  event: AgentHookEventPayload
): Promise<void> {
  const snippet = promptSnippetOf(event);
  if (!snippet) {
    selfHealAgentHooksIfNeeded();
    logTitleTier({ outcome: "empty", panelId: event.panelId, tier: "rule" });
    return;
  }
  rememberFirstPrompt(panelTitleKey(event.windowId, event.panelId), snippet);
  const derived = deriveAgentSessionTitleFromPrompt(snippet);
  if (!derived) {
    logTitleTier({ outcome: "noise", panelId: event.panelId, tier: "rule" });
    return;
  }
  const written = await writeAgentSessionTitle({
    aggregator,
    panelId: event.panelId,
    source: "rule",
    title: derived,
    windowId: event.windowId,
  });
  logTitleTier({
    outcome: written.applied ? "applied" : "rejected-rank",
    panelId: event.panelId,
    tier: "rule",
  });
}

interface PanelTitleState {
  agentId: AgentKind;
  sessionTitle?: string | undefined;
  sessionTitleSource?: string | undefined;
}

function agentStateFor(
  aggregator: ForegroundActivityAggregator,
  windowId: string,
  panelId: string
): PanelTitleState | null {
  const activity = aggregator
    .snapshot(windowId)
    .activities.find((entry) => entry.panelId === panelId);
  if (activity?.kind !== "agent") {
    return null;
  }
  return {
    agentId: activity.agentId,
    sessionTitle: activity.sessionTitle,
    sessionTitleSource: activity.sessionTitleSource,
  };
}

async function onTurnSettled(
  aggregator: ForegroundActivityAggregator,
  event: AgentHookEventPayload
): Promise<void> {
  const session = await readPanelSession(event.windowId, event.panelId);
  const title = session?.sessionTitle?.trim();
  const source = session?.sessionTitleSource;
  if (title && source) {
    aggregator.hydrateAgentSessionTitle(event.windowId, event.panelId, {
      source,
      title,
    });
  }
  if (!TURN_SETTLED_EVENTS.has(event.event)) {
    return;
  }
  await maybeRefine(aggregator, event, session?.context);
}

async function maybeRefine(
  aggregator: ForegroundActivityAggregator,
  event: AgentHookEventPayload,
  context:
    | { cwd?: string | undefined; gitRoot?: string | undefined }
    | undefined
): Promise<void> {
  const key = panelTitleKey(event.windowId, event.panelId);
  const state = agentStateFor(aggregator, event.windowId, event.panelId);
  // 秩已达 model / user → 冻结，不再动。
  if (!state || state.sessionTitleSource === "model") {
    return;
  }
  if (state.sessionTitleSource === "user") {
    return;
  }
  const promptSnippet = firstPromptFor(key);
  if (!promptSnippet) {
    return;
  }
  const deps = agentSessionTitleDeps();
  if (!deps) {
    logTitleTier({
      agentId: state.agentId,
      outcome: "unavailable",
      panelId: event.panelId,
      tier: "model",
    });
    return;
  }
  if (!(await deps.isRefineEnabled())) {
    logTitleTier({
      agentId: state.agentId,
      outcome: "disabled",
      panelId: event.panelId,
      tier: "model",
    });
    return;
  }
  const admission = beginRefine(key);
  if (admission !== "ok") {
    logTitleTier({
      agentId: state.agentId,
      outcome: admission === "busy" ? "concurrency-skipped" : "exhausted",
      panelId: event.panelId,
      tier: "model",
    });
    return;
  }
  const startedAt = Date.now();
  let success = false;
  try {
    success = await runRefine({
      aggregator,
      agentId: state.agentId,
      context,
      deps,
      event,
      promptSnippet,
      startedAt,
    });
  } finally {
    endRefine(key, success);
  }
}

async function runRefine(args: {
  aggregator: ForegroundActivityAggregator;
  agentId: AgentKind;
  context:
    | { cwd?: string | undefined; gitRoot?: string | undefined }
    | undefined;
  deps: NonNullable<ReturnType<typeof agentSessionTitleDeps>>;
  event: AgentHookEventPayload;
  promptSnippet: string;
  startedAt: number;
}): Promise<boolean> {
  const signals = await args.deps.collectGitSignals({
    cwd: args.context?.cwd,
    gitRoot: args.context?.gitRoot,
  });
  const outcome = await refineAgentSessionTitle({
    agentId: args.agentId,
    promptSnippet: args.promptSnippet,
    signals,
  });
  const durationMs = Date.now() - args.startedAt;
  if (outcome.status !== "ok") {
    logTitleTier({
      agentId: args.agentId,
      durationMs,
      outcome: outcome.reason,
      panelId: args.event.panelId,
      tier: "model",
    });
    return false;
  }
  if (outcome.title === deriveAgentSessionTitleFromPrompt(args.promptSnippet)) {
    logTitleTier({
      agentId: args.agentId,
      durationMs,
      outcome: "same-as-rule",
      panelId: args.event.panelId,
      tier: "model",
    });
    // 与规则层同解也算收敛——没有重试的意义。
    return true;
  }
  const written = await writeAgentSessionTitle({
    aggregator: args.aggregator,
    panelId: args.event.panelId,
    source: "model",
    title: outcome.title,
    windowId: args.event.windowId,
  });
  logTitleTier({
    agentId: args.agentId,
    durationMs,
    outcome: written.applied ? "applied" : "rejected-rank",
    panelId: args.event.panelId,
    tier: "model",
  });
  return true;
}
