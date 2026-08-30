import type { AgentKind } from "@shared/contracts/agent.ts";
import {
  type AgentStatusEvidence,
  fact,
  facts,
  installedVersion,
  nativeFact,
  sourceCommit,
  upstream,
} from "./matrix-types.ts";

export const AGENT_STATUS_EVIDENCE_ROWS_A_2 = {
  grok: {
    integration: "active",
    transport: ["hook-command", "transcript-reconciler"],
    transcriptTurnIdentity: "native-field",
    evidence: {
      lifecycle: "native",
      ready: "reconciled",
      processing: "native",
      tool: "native",
      waiting: "native",
      error: "native",
      completed: "reconciled",
      interrupted: "native",
      subagent: "native",
    },
    eventMappings: facts(
      nativeFact("lifecycle", "SessionStart", "SessionStart"),
      nativeFact("control", "Stop", "Stop"),
      fact(
        "ready",
        "reconciled",
        "grok.updates.turn_completed.end_turn",
        "TurnCompleted"
      ),
      nativeFact("lifecycle", "SessionEnd", "SessionEnd"),
      nativeFact("processing", "UserPromptSubmit", "PromptSubmit"),
      nativeFact("tool", "PreToolUse", "ToolStart"),
      // plan 走 Pre/Post Interaction；ask_user_question 只走 transcript
      nativeFact("waiting", "PreToolUse", "InteractionRequested"),
      nativeFact("waiting", "PostToolUse", "InteractionResolved"),
      nativeFact("waiting", "PostToolUseFailure", "InteractionResolved"),
      nativeFact("waiting", "PermissionDenied", "InteractionResolved"),
      fact(
        "waiting",
        "reconciled",
        "grok.updates.ask_user_question",
        "InteractionRequested"
      ),
      fact(
        "waiting",
        "reconciled",
        "grok.updates.ask_user_question.answered",
        "InteractionResolved"
      ),
      nativeFact("processing", "PostToolUse", "ToolComplete"),
      nativeFact("processing", "PostToolUseFailure", "ToolComplete"),
      nativeFact("processing", "PermissionDenied", "ToolComplete"),
      nativeFact("processing", "PreCompact", "processing"),
      nativeFact("processing", "PostCompact", "processing"),
      nativeFact("error", "StopFailure", "error"),
      // 1.0.13 起原生 StopCancelled（reason：user_interrupt/permission_*/
      // max_turns/no_progress/unknown）；updates.jsonl 对账仍是旧版兜底。
      nativeFact("interrupted", "StopCancelled", "TurnInterrupted"),
      fact(
        "interrupted",
        "reconciled",
        "grok.updates.turn_completed.cancelled",
        "TurnInterrupted"
      ),
      fact(
        "completed",
        "reconciled",
        "grok.updates.turn_completed.end_turn",
        "TurnCompleted"
      ),
      nativeFact("subagent", "SubagentStart", "SubagentStart"),
      nativeFact("subagent", "SubagentStop", "SubagentStop")
    ),
    upstream: installedVersion("https://x.ai/cli", "0.2.118"),
  },
  "mimo-code": {
    integration: "active",
    transport: ["hosted-plugin"],
    evidence: {
      lifecycle: "native",
      ready: "native",
      processing: "native",
      tool: "native",
      waiting: "native",
      error: "native",
      completed: "native",
      interrupted: "native",
      subagent: "unsupported",
    },
    eventMappings: facts(
      nativeFact("lifecycle", "session.created", "SessionStart"),
      nativeFact("lifecycle", "session.deleted", "SessionEnd"),
      nativeFact("ready", "session.post=completed", "TurnCompleted"),
      nativeFact("processing", "chat.message", "PromptSubmit"),
      nativeFact(
        "processing",
        "message.part.updated=completed",
        "ToolComplete"
      ),
      nativeFact("processing", "message.part.updated=error", "ToolComplete"),
      nativeFact("processing", "session.pre", "running"),
      nativeFact("processing", "tool.execute.after", "ToolComplete"),
      nativeFact("tool", "tool.execute.before", "ToolStart"),
      nativeFact("waiting", "permission.asked", "InteractionRequested"),
      nativeFact("waiting", "permission.replied", "InteractionResolved"),
      nativeFact("waiting", "question.asked", "InteractionRequested"),
      nativeFact("waiting", "question.replied", "InteractionResolved"),
      nativeFact("waiting", "question.rejected", "InteractionResolved"),
      nativeFact("error", "session.post=error", "error"),
      nativeFact("completed", "session.post=completed", "TurnCompleted"),
      nativeFact("interrupted", "session.post=cancelled", "TurnInterrupted")
    ),
    upstream: sourceCommit(
      "https://github.com/XiaomiMiMo/MiMo-Code/blob/c045a9891069000b112079bb10bdc8828d75eb6e/packages/opencode/src/permission/index.ts",
      "c045a9891069000b112079bb10bdc8828d75eb6e"
    ),
  },
  ante: {
    integration: "not-integrated",
    transport: ["none"],
    evidence: {
      lifecycle: "unsupported",
      ready: "unsupported",
      processing: "unsupported",
      tool: "unsupported",
      waiting: "unsupported",
      error: "unsupported",
      completed: "unsupported",
      interrupted: "unsupported",
      subagent: "unsupported",
    },
    eventMappings: facts(),
    // Ante 已有完整 JSONL client-daemon protocol；这里的 unsupported
    // 只表示 Pier 尚未接入该 transport，不表示 Ante 产品缺少状态事实。
    upstream: sourceCommit(
      "https://github.com/AntigmaLabs/ante-preview/blob/main/crates/protocol-shape/src/msg.rs",
      "5e1ace43d5fd3e09e74c5f347ff8f26d585638fb"
    ),
  },
  omp: {
    integration: "active",
    transport: ["hosted-plugin"],
    evidence: {
      lifecycle: "native",
      ready: "native",
      processing: "native",
      tool: "native",
      waiting: "native",
      error: "native",
      completed: "native",
      interrupted: "native",
      subagent: "unsupported",
    },
    eventMappings: facts(
      nativeFact("lifecycle", "session_start", "SessionStart"),
      nativeFact("lifecycle", "session_shutdown", "SessionEnd"),
      nativeFact("ready", "agent_end.completed", "TurnCompleted"),
      nativeFact("ready", "session_stop", "Stop"),
      nativeFact("processing", "agent_start", "processing"),
      nativeFact("processing", "before_agent_start", "PromptSubmit"),
      nativeFact("processing", "agent_end.willContinue", "processing"),
      nativeFact("processing", "agent_end.toolUseDeferred", "processing"),
      nativeFact("tool", "tool_execution_start", "ToolStart"),
      nativeFact("waiting", "tool_execution_start.ask", "InteractionRequested"),
      nativeFact("waiting", "tool_execution_end.ask", "InteractionResolved"),
      nativeFact("waiting", "tool_approval_requested", "InteractionRequested"),
      nativeFact("waiting", "tool_approval_resolved", "InteractionResolved"),
      nativeFact("processing", "tool_execution_end", "ToolComplete"),
      nativeFact("error", "agent_end.error", "error"),
      nativeFact("interrupted", "agent_end.aborted", "TurnInterrupted"),
      nativeFact("completed", "agent_end.completed", "TurnCompleted")
    ),
    upstream: sourceCommit(
      "https://omp.sh/docs",
      "cc00ab161b2721e50d8a96a0dc9552abfd258b8b"
    ),
  },
  antigravity: {
    integration: "active",
    transport: ["hook-command"],
    evidence: {
      lifecycle: "unsupported",
      ready: "unsupported",
      processing: "native",
      tool: "unsupported",
      waiting: "unsupported",
      error: "native",
      completed: "unsupported",
      interrupted: "unsupported",
      subagent: "unsupported",
    },
    eventMappings: facts(
      nativeFact("control", "Stop.fullyIdle", "Stop"),
      nativeFact("processing", "PreInvocation", "processing"),
      nativeFact("processing", "Stop.active", "processing"),
      nativeFact("error", "Stop.error", "error")
    ),
    upstream: upstream(
      "https://www.antigravity.google/docs/hooks",
      "Antigravity CLI hook documentation"
    ),
  },
  goose: {
    integration: "active",
    transport: ["hook-command"],
    evidence: {
      lifecycle: "native",
      ready: "unsupported",
      processing: "native",
      tool: "native",
      waiting: "unsupported",
      error: "unsupported",
      completed: "unsupported",
      interrupted: "unsupported",
      subagent: "unsupported",
    },
    eventMappings: facts(
      nativeFact("control", "Stop", "Stop"),
      nativeFact("processing", "UserPromptSubmit", "PromptSubmit"),
      nativeFact("processing", "PostToolUse", "ToolComplete"),
      nativeFact("processing", "PostToolUseFailure", "ToolComplete"),
      nativeFact("tool", "PreToolUse", "ToolStart"),
      nativeFact("lifecycle", "SessionStart", "SessionStart"),
      nativeFact("lifecycle", "SessionEnd", "SessionEnd")
    ),
    upstream: sourceCommit(
      "https://block.github.io/goose/docs/quickstart/",
      "8b73e1a1b6b9e960304fdf9b25ea2f8cec4329a8"
    ),
  },
  cursor: {
    integration: "active",
    transport: ["hook-command", "transcript-reconciler"],
    transcriptTurnIdentity: "absent",
    evidence: {
      lifecycle: "native",
      ready: "native",
      processing: "native",
      tool: "native",
      waiting: "native",
      error: "native",
      completed: "native",
      interrupted: "native",
      subagent: "native",
    },
    eventMappings: facts(
      nativeFact("lifecycle", "sessionStart", "SessionStart"),
      nativeFact("lifecycle", "sessionEnd", "SessionEnd"),
      nativeFact("ready", "stop.status=completed", "TurnCompleted"),
      fact(
        "ready",
        "reconciled",
        "cursor.transcript.turn_ended",
        "TurnCompleted"
      ),
      nativeFact("processing", "beforeSubmitPrompt", "PromptSubmit"),
      nativeFact("processing", "postToolUse", "ToolComplete"),
      nativeFact("processing", "postToolUseFailure", "ToolComplete"),
      nativeFact("tool", "preToolUse", "ToolStart"),
      nativeFact("waiting", "preToolUse", "InteractionRequested"),
      nativeFact("waiting", "postToolUse", "InteractionResolved"),
      nativeFact("waiting", "postToolUseFailure", "InteractionResolved"),
      fact(
        "waiting",
        "reconciled",
        "cursor.transcript.ask_question",
        "InteractionRequested"
      ),
      fact(
        "waiting",
        "reconciled",
        "cursor.transcript.ask_question.answered",
        "InteractionResolved"
      ),
      fact(
        "waiting",
        "reconciled",
        "cursor.transcript.create_plan",
        "InteractionRequested"
      ),
      fact(
        "waiting",
        "reconciled",
        "cursor.transcript.create_plan.answered",
        "InteractionResolved"
      ),
      nativeFact("error", "stop.status=error", "error"),
      nativeFact("completed", "stop.status=completed", "TurnCompleted"),
      fact(
        "completed",
        "reconciled",
        "cursor.transcript.turn_ended",
        "TurnCompleted"
      ),
      nativeFact("interrupted", "stop.status=aborted", "TurnInterrupted"),
      fact(
        "interrupted",
        "reconciled",
        "cursor.transcript.turn_ended.aborted",
        "TurnInterrupted"
      ),
      nativeFact("subagent", "subagentStart", "SubagentStart"),
      nativeFact("subagent", "subagentStop", "SubagentStop"),
      // Task 派发工具按 Subagent 生命周期分发（2026-08-29 events.jsonl 实证：
      // preToolUse 带主 conversation_id + 子智能体 generation_id 且永无
      // postToolUse；原生 subagentStart/Stop 在当前 CLI 版本不触发）。
      nativeFact("subagent", "preToolUse", "SubagentStart"),
      nativeFact("subagent", "postToolUse", "SubagentStop"),
      nativeFact("subagent", "postToolUseFailure", "SubagentStop")
    ),
    upstream: upstream(
      "https://cursor.com/docs/hooks",
      "Cursor CLI hooks documentation"
    ),
  },
} as const satisfies Partial<Record<AgentKind, AgentStatusEvidence>>;
