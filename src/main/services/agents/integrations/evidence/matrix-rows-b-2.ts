import type { AgentKind } from "@shared/contracts/agent.ts";
import {
  type AgentStatusEvidence,
  facts,
  installedVersion,
  nativeFact,
  sourceCommit,
  upstream,
} from "./matrix-types.ts";

export const AGENT_STATUS_EVIDENCE_ROWS_B_2 = {
  rovo: {
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
    // 默认 TUI 的 eventHooks 只有 on_complete/on_error/on_tool_permission 等
    // 命令回调；官方仍在探索 hook 输入/输出，当前没有稳定的 session/tool id
    // 载荷契约。server mode 虽提供 SSE、session 与具名 tool approval，但切换
    // 到 server 会改变 Pier 的默认终端模式，因此不接入两条通路。
    upstream: upstream(
      "https://www.atlassian.com/blog/developers/streamline-rovo-dev-cli-with-event-hooks",
      "Rovo Dev CLI event hooks announcement"
    ),
  },
  hermes: {
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
      subagent: "native",
    },
    eventMappings: facts(
      nativeFact("lifecycle", "on_session_start", "SessionStart"),
      nativeFact("lifecycle", "on_session_reset", "SessionStart"),
      nativeFact("lifecycle", "on_session_finalize", "SessionEnd"),
      nativeFact("ready", "on_session_end.completed", "TurnCompleted"),
      nativeFact("processing", "pre_llm_call", "PromptSubmit"),
      nativeFact("processing", "post_tool_call", "ToolComplete"),
      nativeFact("tool", "pre_tool_call", "ToolStart"),
      nativeFact("waiting", "pre_tool_call.clarify", "InteractionRequested"),
      nativeFact("waiting", "post_tool_call.clarify", "InteractionResolved"),
      nativeFact("waiting", "pre_approval_request", "InteractionRequested"),
      nativeFact("waiting", "post_approval_response", "InteractionResolved"),
      nativeFact("error", "on_session_end.failed", "error"),
      nativeFact("completed", "on_session_end.completed", "TurnCompleted"),
      nativeFact(
        "interrupted",
        "on_session_end.interrupted",
        "TurnInterrupted"
      ),
      nativeFact("subagent", "subagent_start", "SubagentStart"),
      nativeFact("subagent", "subagent_stop", "SubagentStop")
    ),
    upstream: sourceCommit(
      "https://github.com/NousResearch/hermes-agent",
      "cbecd72e976a59e4c4b8277086abaa59ab3dc510"
    ),
  },
  openclaw: {
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
    // typed plugin hooks 已覆盖 tool/session/agent/subagent，但插件运行在长期
    // Gateway 进程。Pier 当前事件发送依赖 PTY 注入的 PIER_PANEL_ID、
    // PIER_WINDOW_ID 与事件日志路径；Gateway 不继承这组每面板动态路由凭证，
    // 仅安装受管插件无法把 sessionKey/runId 安全归属到 Pier panel。
    upstream: sourceCommit(
      "https://github.com/openclaw/openclaw/blob/b4d14d78480650860423964b4b450e8a3f878150/docs/plugins/hooks.md",
      "b4d14d78480650860423964b4b450e8a3f878150"
    ),
  },
  devin: {
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
      nativeFact("processing", "PostCompaction", "processing"),
      nativeFact("processing", "PostToolUse", "ToolComplete"),
      nativeFact("tool", "PreToolUse", "ToolStart")
    ),
    upstream: upstream(
      "https://docs.devin.ai/cli/extensibility/hooks/lifecycle-hooks",
      "Devin CLI hooks documentation"
    ),
  },
  openclaude: {
    integration: "active",
    transport: ["hook-command"],
    evidence: {
      lifecycle: "native",
      ready: "unsupported",
      processing: "native",
      tool: "native",
      waiting: "unsupported",
      error: "native",
      completed: "unsupported",
      interrupted: "unsupported",
      subagent: "native",
    },
    eventMappings: facts(
      nativeFact("lifecycle", "SessionStart", "SessionStart"),
      nativeFact("lifecycle", "SessionEnd", "SessionEnd"),
      nativeFact("control", "Stop", "Stop"),
      nativeFact("processing", "UserPromptSubmit", "PromptSubmit"),
      nativeFact("processing", "PostToolUse", "ToolComplete"),
      nativeFact("processing", "PostToolUseFailure", "ToolComplete"),
      nativeFact("processing", "PreCompact", "processing"),
      nativeFact("processing", "PostCompact", "processing"),
      nativeFact("tool", "PreToolUse", "ToolStart"),
      nativeFact("error", "StopFailure", "error"),
      nativeFact("subagent", "SubagentStart", "SubagentStart"),
      nativeFact("subagent", "SubagentStop", "SubagentStop")
    ),
    upstream: sourceCommit(
      "https://github.com/Gitlawb/openclaude/blob/main/src/entrypoints/sdk/coreTypes.ts",
      "c2030bbb2bd62fc56a8dd58748e039682e05aa97"
    ),
  },
  codebuddy: {
    integration: "active",
    transport: ["hook-command"],
    evidence: {
      lifecycle: "native",
      ready: "unsupported",
      processing: "native",
      tool: "native",
      waiting: "native",
      error: "native",
      completed: "unsupported",
      interrupted: "unsupported",
      subagent: "native",
    },
    eventMappings: facts(
      nativeFact("lifecycle", "SessionStart", "SessionStart"),
      nativeFact("lifecycle", "SessionEnd", "SessionEnd"),
      nativeFact("control", "Stop", "Stop"),
      nativeFact("processing", "UserPromptSubmit", "PromptSubmit"),
      nativeFact("processing", "PostToolUse", "ToolComplete"),
      nativeFact("processing", "PostToolUseFailure", "ToolComplete"),
      nativeFact("processing", "PreCompact", "processing"),
      nativeFact("processing", "PostCompact", "processing"),
      nativeFact("tool", "PreToolUse", "ToolStart"),
      nativeFact("waiting", "Elicitation", "InteractionRequested"),
      nativeFact("waiting", "ElicitationResult", "InteractionResolved"),
      nativeFact("error", "StopFailure", "error"),
      nativeFact("subagent", "SubagentStart", "SubagentStart"),
      nativeFact("subagent", "SubagentStop", "SubagentStop")
    ),
    upstream: installedVersion(
      "https://www.codebuddy.ai/docs/cli/hooks",
      "2.122.0"
    ),
  },
  qodercli: {
    integration: "active",
    transport: ["hook-command"],
    evidence: {
      lifecycle: "native",
      ready: "unsupported",
      processing: "native",
      tool: "native",
      waiting: "native",
      error: "native",
      completed: "unsupported",
      interrupted: "unsupported",
      subagent: "native",
    },
    eventMappings: facts(
      nativeFact("lifecycle", "SessionStart", "SessionStart"),
      nativeFact("lifecycle", "SessionEnd", "SessionEnd"),
      nativeFact("control", "Stop", "Stop"),
      nativeFact("processing", "UserPromptSubmit", "PromptSubmit"),
      nativeFact("processing", "PostToolUse", "ToolComplete"),
      nativeFact("processing", "PostToolUseFailure", "ToolComplete"),
      nativeFact("processing", "PreCompact", "processing"),
      nativeFact("processing", "PostCompact", "processing"),
      nativeFact("tool", "PreToolUse", "ToolStart"),
      nativeFact("waiting", "Elicitation", "InteractionRequested"),
      nativeFact("waiting", "ElicitationResult", "InteractionResolved"),
      nativeFact("error", "StopFailure", "error"),
      nativeFact("subagent", "SubagentStart", "SubagentStart"),
      nativeFact("subagent", "SubagentStop", "SubagentStop")
    ),
    upstream: upstream(
      "https://docs.qoder.com/en/cli/hooks",
      "Qoder CLI hooks documentation"
    ),
  },
} as const satisfies Partial<Record<AgentKind, AgentStatusEvidence>>;
