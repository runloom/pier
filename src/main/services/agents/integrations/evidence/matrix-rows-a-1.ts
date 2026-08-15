import type { AgentKind } from "@shared/contracts/agent.ts";
import {
  type AgentStatusEvidence,
  fact,
  facts,
  nativeFact,
  sourceCommit,
  upstream,
} from "./matrix-types.ts";

export const AGENT_STATUS_EVIDENCE_ROWS_A_1 = {
  claude: {
    integration: "active",
    transport: ["hook-command", "transcript-reconciler"],
    evidence: {
      lifecycle: "native",
      ready: "native",
      processing: "native",
      tool: "native",
      waiting: "native",
      error: "native",
      completed: "native",
      interrupted: "reconciled",
      subagent: "native",
    },
    eventMappings: facts(
      nativeFact("lifecycle", "SessionStart", "SessionStart"),
      nativeFact("lifecycle", "SessionEnd", "SessionEnd"),
      nativeFact("control", "Stop", "Stop"),
      // Notification matcher=idle_prompt：Claude 自报空闲等输入（Esc 缺 interrupt 时 ready 兜底）
      nativeFact("ready", "Notification", "TurnCompleted"),
      nativeFact("completed", "Notification", "TurnCompleted"),
      // Stop 漏报时：assistant stop_reason 终态 → ready
      fact(
        "ready",
        "reconciled",
        "claude.transcript.assistant_stop",
        "TurnCompleted"
      ),
      fact(
        "completed",
        "reconciled",
        "claude.transcript.assistant_stop",
        "TurnCompleted"
      ),
      fact(
        "ready",
        "reconciled",
        "claude.transcript.user_interrupt",
        "TurnInterrupted"
      ),
      nativeFact("processing", "UserPromptSubmit", "PromptSubmit"),
      nativeFact("processing", "PostToolUse", "ToolComplete"),
      nativeFact("processing", "PostToolUseFailure", "ToolComplete"),
      nativeFact("processing", "PreCompact", "processing"),
      nativeFact("processing", "PostCompact", "processing"),
      nativeFact("tool", "PreToolUse", "ToolStart"),
      // 同 Pre/Post 原生事件按 tool_name 分发；工具名单见 interactive-blocking-tools.ts
      nativeFact("waiting", "PreToolUse", "InteractionRequested"),
      nativeFact("waiting", "PostToolUse", "InteractionResolved"),
      nativeFact("waiting", "PostToolUseFailure", "InteractionResolved"),
      nativeFact("error", "StopFailure", "error"),
      fact(
        "interrupted",
        "reconciled",
        "claude.transcript.user_interrupt",
        "TurnInterrupted"
      ),
      nativeFact("subagent", "SubagentStart", "SubagentStart"),
      nativeFact("subagent", "SubagentStop", "SubagentStop")
    ),
    upstream: upstream(
      "https://code.claude.com/docs/en/hooks",
      "Claude Code hooks documentation"
    ),
  },
  codex: {
    integration: "active",
    transport: ["hook-command", "transcript-reconciler"],
    evidence: {
      lifecycle: "native",
      ready: "reconciled",
      processing: "native",
      tool: "native",
      waiting: "reconciled",
      error: "unsupported",
      completed: "reconciled",
      interrupted: "reconciled",
      subagent: "native",
    },
    eventMappings: facts(
      nativeFact("lifecycle", "SessionStart", "SessionStart"),
      nativeFact("lifecycle", "SessionEnd", "SessionEnd"),
      nativeFact("control", "Stop", "Stop"),
      fact(
        "ready",
        "reconciled",
        "codex.transcript.task_complete",
        "TurnCompleted"
      ),
      nativeFact("processing", "UserPromptSubmit", "PromptSubmit"),
      nativeFact("processing", "PostToolUse", "ToolComplete"),
      nativeFact("processing", "PreCompact", "processing"),
      nativeFact("processing", "PostCompact", "processing"),
      nativeFact("tool", "PreToolUse", "ToolStart"),
      fact(
        "completed",
        "reconciled",
        "codex.transcript.task_complete",
        "TurnCompleted"
      ),
      fact(
        "interrupted",
        "reconciled",
        "codex.transcript.turn_aborted",
        "TurnInterrupted"
      ),
      fact(
        "waiting",
        "reconciled",
        "codex.transcript.request_user_input",
        "InteractionRequested"
      ),
      fact(
        "waiting",
        "reconciled",
        "codex.transcript.request_user_input.output",
        "InteractionResolved"
      ),
      fact(
        "waiting",
        "reconciled",
        "codex.transcript.request_permissions",
        "InteractionRequested"
      ),
      fact(
        "waiting",
        "reconciled",
        "codex.transcript.request_permissions.output",
        "InteractionResolved"
      ),
      nativeFact("subagent", "SubagentStart", "SubagentStart"),
      nativeFact("subagent", "SubagentStop", "SubagentStop")
    ),
    upstream: sourceCommit(
      "https://developers.openai.com/codex/hooks/",
      "a4d2f3102249a94835e96910a3649a830182813e"
    ),
  },
  gemini: {
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
      nativeFact("lifecycle", "SessionStart", "SessionStart"),
      nativeFact("lifecycle", "SessionEnd", "SessionEnd"),
      nativeFact("control", "AfterAgent", "Stop"),
      nativeFact("processing", "BeforeAgent", "PromptSubmit"),
      nativeFact("processing", "AfterTool", "ToolComplete"),
      nativeFact("processing", "PreCompress", "processing"),
      nativeFact("tool", "BeforeTool", "ToolStart")
    ),
    upstream: sourceCommit(
      "https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/hooks/types.ts",
      "3499c84f7b8e70c86600e7cd2c67a7c65a667f5e"
    ),
  },
  aider: {
    integration: "retired",
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
    upstream: sourceCommit(
      "https://github.com/Aider-AI/aider/blob/main/aider/website/docs/usage/notifications.md",
      "5dc9490bb35f9729ef2c95d00a19ccd30c26339c"
    ),
  },
  opencode: {
    integration: "active",
    transport: ["hosted-plugin"],
    evidence: {
      lifecycle: "native",
      ready: "native",
      processing: "native",
      tool: "native",
      waiting: "native",
      error: "native",
      completed: "unsupported",
      interrupted: "unsupported",
      subagent: "native",
    },
    eventMappings: facts(
      nativeFact("lifecycle", "session.created", "SessionStart"),
      nativeFact("lifecycle", "session.deleted", "SessionEnd"),
      nativeFact("ready", "session.idle", "Stop"),
      nativeFact("ready", "session.status=idle", "Stop"),
      nativeFact("processing", "chat.message", "PromptSubmit"),
      nativeFact(
        "processing",
        "message.part.updated=completed",
        "ToolComplete"
      ),
      nativeFact("processing", "message.part.updated=error", "ToolComplete"),
      nativeFact("processing", "session.status=busy", "running"),
      nativeFact("processing", "session.status=retry", "running"),
      nativeFact("processing", "tool.execute.after", "ToolComplete"),
      nativeFact("tool", "tool.execute.before", "ToolStart"),
      nativeFact("waiting", "permission.asked", "InteractionRequested"),
      nativeFact("waiting", "permission.replied", "InteractionResolved"),
      nativeFact("waiting", "question.asked", "InteractionRequested"),
      nativeFact("waiting", "question.replied", "InteractionResolved"),
      nativeFact("waiting", "question.rejected", "InteractionResolved"),
      nativeFact("error", "session.error", "error"),
      nativeFact("subagent", "session.status=busy.child", "SubagentStart"),
      nativeFact("subagent", "session.status=retry.child", "SubagentStart"),
      nativeFact("subagent", "session.status=idle.child", "SubagentStop"),
      nativeFact("subagent", "session.error.child", "SubagentStop"),
      nativeFact("subagent", "session.deleted.child", "SubagentStop")
    ),
    upstream: sourceCommit(
      "https://opencode.ai/docs/plugins/",
      "e8b09927889ba4b5b7fc74bbab5b864d205406ca"
    ),
  },
  cursor: {
    integration: "active",
    transport: ["hook-command"],
    evidence: {
      lifecycle: "native",
      ready: "native",
      processing: "native",
      tool: "native",
      waiting: "unsupported",
      error: "native",
      completed: "native",
      interrupted: "native",
      subagent: "native",
    },
    eventMappings: facts(
      nativeFact("lifecycle", "sessionStart", "SessionStart"),
      nativeFact("lifecycle", "sessionEnd", "SessionEnd"),
      nativeFact("ready", "stop.status=completed", "TurnCompleted"),
      nativeFact("processing", "beforeSubmitPrompt", "PromptSubmit"),
      nativeFact("processing", "postToolUse", "ToolComplete"),
      nativeFact("processing", "postToolUseFailure", "ToolComplete"),
      nativeFact("tool", "preToolUse", "ToolStart"),
      nativeFact("error", "stop.status=error", "error"),
      nativeFact("completed", "stop.status=completed", "TurnCompleted"),
      nativeFact("interrupted", "stop.status=aborted", "TurnInterrupted"),
      nativeFact("subagent", "subagentStart", "SubagentStart"),
      nativeFact("subagent", "subagentStop", "SubagentStop")
    ),
    upstream: upstream(
      "https://cursor.com/docs/hooks",
      "Cursor CLI hooks documentation"
    ),
  },
  copilot: {
    integration: "active",
    transport: ["hook-command", "transcript-reconciler"],
    evidence: {
      lifecycle: "native",
      ready: "reconciled",
      processing: "native",
      tool: "native",
      waiting: "unsupported",
      error: "native",
      completed: "reconciled",
      interrupted: "reconciled",
      subagent: "native",
    },
    eventMappings: facts(
      nativeFact("lifecycle", "sessionStart", "SessionStart"),
      nativeFact("lifecycle", "sessionEnd", "SessionEnd"),
      nativeFact("control", "agentStop", "Stop"),
      fact(
        "ready",
        "reconciled",
        "copilot.events.assistant.turn_end",
        "TurnCompleted"
      ),
      fact(
        "ready",
        "reconciled",
        "copilot.events.abort.user_initiated",
        "TurnInterrupted"
      ),
      nativeFact("processing", "userPromptSubmitted", "PromptSubmit"),
      nativeFact("processing", "postToolUse", "ToolComplete"),
      nativeFact("processing", "postToolUseFailure", "ToolComplete"),
      nativeFact("processing", "preCompact", "processing"),
      nativeFact("processing", "errorOccurred.recoverable", "processing"),
      nativeFact("tool", "preToolUse", "ToolStart"),
      nativeFact("error", "errorOccurred", "error"),
      fact(
        "completed",
        "reconciled",
        "copilot.events.assistant.turn_end",
        "TurnCompleted"
      ),
      fact(
        "interrupted",
        "reconciled",
        "copilot.events.abort.user_initiated",
        "TurnInterrupted"
      ),
      nativeFact("subagent", "subagentStart", "SubagentStart"),
      nativeFact("subagent", "subagentStop", "SubagentStop")
    ),
    upstream: upstream(
      "https://docs.github.com/en/copilot/reference/hooks-reference",
      "GitHub Copilot CLI hooks documentation"
    ),
  },
  droid: {
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
      nativeFact("lifecycle", "SessionStart", "SessionStart"),
      nativeFact("lifecycle", "SessionEnd", "SessionEnd"),
      nativeFact("control", "Stop", "Stop"),
      nativeFact("processing", "UserPromptSubmit", "PromptSubmit"),
      nativeFact("processing", "PostToolUse", "ToolComplete"),
      nativeFact("processing", "PreCompact", "processing"),
      nativeFact("tool", "PreToolUse", "ToolStart")
    ),
    upstream: upstream(
      "https://docs.factory.ai/harness/hooks",
      "Factory Droid hooks documentation"
    ),
  },
  kimi: {
    integration: "active",
    transport: ["hook-command", "transcript-reconciler"],
    evidence: {
      lifecycle: "native",
      ready: "reconciled",
      processing: "native",
      tool: "native",
      waiting: "unsupported",
      error: "native",
      completed: "reconciled",
      interrupted: "reconciled",
      subagent: "native",
    },
    eventMappings: facts(
      nativeFact("lifecycle", "SessionStart", "SessionStart"),
      nativeFact("lifecycle", "SessionEnd", "SessionEnd"),
      nativeFact("control", "Stop", "Stop"),
      fact("ready", "reconciled", "kimi.wire.TurnEnd", "TurnCompleted"),
      nativeFact("processing", "UserPromptSubmit", "PromptSubmit"),
      nativeFact("tool", "PreToolUse", "ToolStart"),
      nativeFact("processing", "PostToolUse", "ToolComplete"),
      nativeFact("processing", "PostToolUseFailure", "ToolComplete"),
      nativeFact("processing", "PreCompact", "processing"),
      nativeFact("processing", "PostCompact", "processing"),
      nativeFact("error", "StopFailure", "error"),
      fact("completed", "reconciled", "kimi.wire.TurnEnd", "TurnCompleted"),
      nativeFact("subagent", "SubagentStart", "SubagentStart"),
      nativeFact("subagent", "SubagentStop", "SubagentStop")
    ),
    upstream: sourceCommit(
      "https://github.com/MoonshotAI/kimi-cli/blob/4a550effdfcb29a25a5d325bf935296cc50cd417/src/kimi_cli/hooks/config.py",
      "4a550effdfcb29a25a5d325bf935296cc50cd417"
    ),
  },
  pi: {
    integration: "active",
    transport: ["hosted-plugin"],
    evidence: {
      lifecycle: "native",
      ready: "native",
      processing: "native",
      tool: "native",
      waiting: "native",
      error: "unsupported",
      completed: "unsupported",
      interrupted: "unsupported",
      subagent: "unsupported",
    },
    eventMappings: facts(
      nativeFact("lifecycle", "session_start", "SessionStart"),
      nativeFact("lifecycle", "session_shutdown", "SessionEnd"),
      nativeFact("ready", "agent_settled", "Stop"),
      nativeFact("processing", "before_agent_start", "PromptSubmit"),
      nativeFact("processing", "tool_execution_end", "ToolComplete"),
      nativeFact("tool", "tool_execution_start", "ToolStart"),
      nativeFact("waiting", "tool_execution_start.ask", "InteractionRequested"),
      nativeFact("waiting", "tool_execution_end.ask", "InteractionResolved")
    ),
    upstream: sourceCommit(
      "https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md",
      "0c32e83a352a4284133b2544f730a23814948ac3"
    ),
  },
  amp: {
    integration: "active",
    transport: ["hosted-plugin"],
    evidence: {
      lifecycle: "native",
      ready: "native",
      processing: "native",
      tool: "unsupported",
      waiting: "native",
      error: "native",
      completed: "native",
      interrupted: "native",
      subagent: "unsupported",
    },
    eventMappings: facts(
      nativeFact("lifecycle", "session.start", "SessionStart"),
      nativeFact("ready", "agent.end.done", "TurnCompleted"),
      nativeFact("processing", "agent.start", "PromptSubmit"),
      nativeFact("processing", "thread.state.running", "running"),
      nativeFact(
        "waiting",
        "thread.state.awaiting-approval",
        "InteractionRequested"
      ),
      nativeFact(
        "waiting",
        "thread.state.running.resolved",
        "InteractionResolved"
      ),
      nativeFact("waiting", "thread.state.idle", "InteractionResolved"),
      nativeFact(
        "waiting",
        "thread.state.error.resolved",
        "InteractionResolved"
      ),
      nativeFact("error", "agent.end.error", "error"),
      nativeFact("error", "thread.state.error", "error"),
      nativeFact("completed", "agent.end.done", "TurnCompleted"),
      nativeFact("interrupted", "agent.end.cancelled", "TurnInterrupted")
    ),
    upstream: upstream(
      "https://ampcode.com/manual/plugin-api",
      "Amp plugin API"
    ),
  },
} as const satisfies Partial<Record<AgentKind, AgentStatusEvidence>>;
