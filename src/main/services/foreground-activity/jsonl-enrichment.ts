import { SUBAGENT_HOOK_EVENTS } from "@shared/agent-session-actor.ts";
import type {
  AgentHookEventPayload,
  CommandFinishedHookEvent,
  CommandStartHookEvent,
} from "@shared/contracts/agent/session.ts";
import { agentHookEventSchema } from "@shared/contracts/agent/session.ts";

/**
 * hook 原始 payload（metadataBase64）→ 顶层身份字段富化。
 * 从 jsonl-observer 拆出（文件行数门禁）；语义与消费方不变。
 *
 * Subagent 生命周期事件（SubagentStart/SubagentStop）的 sessionId/turnId
 * 由适配器 shell 层显式决定（sessionIdAsParent 把子会话号挪到
 * parentSessionId、suppressTurnId 抑制子回合号）；metadata 里的
 * session_id/turn_id 是同一批被抑制的原始键，回填会原样撤销抑制——
 * codex 子回合字段恰好叫 turn_id、claude/cursor 的父会话号恰好叫
 * session_id/conversation_id。这两个字段对 Subagent 事件只信行上顶层值。
 */
export function enrichAgentEventFromRawPayload(
  event:
    | AgentHookEventPayload
    | CommandFinishedHookEvent
    | CommandStartHookEvent
): AgentHookEventPayload | CommandFinishedHookEvent | CommandStartHookEvent {
  if (event.kind !== "agentEvent" || !event.metadataBase64) {
    return event;
  }
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(event.metadataBase64, "base64").toString("utf8")
    );
    if (!(parsed && typeof parsed === "object" && !Array.isArray(parsed))) {
      return event;
    }
    const payload = parsed as Record<string, unknown>;
    const readString = (...keys: string[]): string | undefined => {
      for (const key of keys) {
        const value = payload[key];
        if (typeof value === "string") {
          return value;
        }
      }
      return;
    };
    const promptSnippet =
      event.v === 1
        ? undefined
        : (readString("promptSnippet", "prompt_snippet") ??
          event.promptSnippet);
    const suppressedIdentity = SUBAGENT_HOOK_EVENTS.has(event.event);
    // v1 agentEvent is `.strict()` and has no promptSnippet — omit the key
    // entirely so enrichment cannot fail validation and fall back to the
    // un-enriched line (which would keep nested/tool_input session ids).
    const candidate = {
      ...event,
      agentInstanceId:
        readString("agent_id", "agentId") ?? event.agentInstanceId,
      agentType: readString("agent_type", "agentType") ?? event.agentType,
      sessionId: suppressedIdentity
        ? event.sessionId
        : (readString(
            "session_id",
            "sessionId",
            "conversation_id",
            "conversationId",
            "task_id",
            "taskId"
          ) ?? event.sessionId),
      toolName: readString("tool_name", "toolName") ?? event.toolName,
      toolUseId:
        readString("tool_use_id", "toolUseId", "tool_call_id", "toolCallId") ??
        event.toolUseId,
      transcriptPath:
        readString("transcript_path", "transcriptPath") ?? event.transcriptPath,
      turnId: suppressedIdentity
        ? event.turnId
        : (readString("turn_id", "turnId") ?? event.turnId),
      ...(event.v === 1
        ? {}
        : {
            parentSessionId:
              readString("parent_session_id", "parentSessionId") ??
              event.parentSessionId,
          }),
      ...(promptSnippet === undefined ? {} : { promptSnippet }),
    };
    const validated = agentHookEventSchema.safeParse(candidate);
    return validated.success ? validated.data : event;
  } catch {
    return event;
  }
}
