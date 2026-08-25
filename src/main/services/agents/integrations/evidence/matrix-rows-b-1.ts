import type { AgentKind } from "@shared/contracts/agent.ts";
import {
  type AgentStatusEvidence,
  facts,
  nativeFact,
  sourceCommit,
  upstream,
} from "./matrix-types.ts";

export const AGENT_STATUS_EVIDENCE_ROWS_B_1 = {
  kilo: {
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
      nativeFact("waiting", "question.asked.blocking", "InteractionRequested"),
      nativeFact("waiting", "question.replied", "InteractionResolved"),
      nativeFact("waiting", "question.rejected", "InteractionResolved"),
      nativeFact("waiting", "session.status=offline", "InteractionRequested"),
      nativeFact("waiting", "session.network.replied", "InteractionResolved"),
      nativeFact("waiting", "session.network.rejected", "InteractionResolved"),
      nativeFact("waiting", "session.network.restored", "InteractionResolved"),
      nativeFact(
        "waiting",
        "session.status=busy.offline",
        "InteractionResolved"
      ),
      nativeFact(
        "waiting",
        "session.status=retry.offline",
        "InteractionResolved"
      ),
      nativeFact("error", "session.error", "error"),
      nativeFact("subagent", "session.status=busy.child", "SubagentStart"),
      nativeFact("subagent", "session.status=retry.child", "SubagentStart"),
      nativeFact("subagent", "session.status=idle.child", "SubagentStop"),
      nativeFact("subagent", "session.error.child", "SubagentStop"),
      nativeFact("subagent", "session.deleted.child", "SubagentStop")
    ),
    upstream: sourceCommit(
      "https://kilo.ai/docs/automate/extending/plugins",
      "c0ebf987789ab6fa070106219ebc8c46cd0105af"
    ),
  },
  kiro: {
    integration: "cleanup-only",
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
    // Kiro CLI 2.13.0 起支持 ~/.kiro/hooks/ 全局 hooks，但该能力只在
    // v3 生效；v3 仍须显式传 kiro-cli --v3。Pier 默认启动
    // kiro-cli chat --tui，不能在不改变终端模式的前提下安装有效 hook，
    // 因此这里只清理历史 Pier 条目。
    upstream: upstream(
      "https://kiro.dev/docs/cli/v3/",
      "Kiro CLI 3.0 early access hooks documentation"
    ),
  },
  crush: {
    integration: "cleanup-only",
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
      "https://github.com/charmbracelet/crush/tree/main/docs/hooks",
      "b83944c45805a4b7abcf3e245acddb8e58294972"
    ),
  },
  aug: {
    integration: "active",
    transport: ["hook-command"],
    evidence: {
      lifecycle: "native",
      // ready/interrupted 只剩 host 裸 Esc（reconciled）：官方 hook 面无
      // per-turn 信号，trusted 终态封账后同会话无重开通道（见 aug.ts 审计注释）。
      ready: "reconciled",
      processing: "native",
      tool: "native",
      waiting: "unsupported",
      error: "native",
      completed: "unsupported",
      interrupted: "reconciled",
      subagent: "unsupported",
    },
    eventMappings: facts(
      nativeFact("lifecycle", "SessionStart", "SessionStart"),
      nativeFact("lifecycle", "SessionEnd", "SessionEnd"),
      nativeFact("control", "Stop", "Stop"),
      nativeFact("processing", "PostToolUse", "ToolComplete"),
      nativeFact("tool", "PreToolUse", "ToolStart"),
      nativeFact("error", "Stop", "error")
    ),
    upstream: upstream(
      "https://docs.augmentcode.com/cli/hooks",
      "Augment Code hook documentation"
    ),
  },
  autohand: {
    integration: "active",
    transport: ["hook-command"],
    evidence: {
      lifecycle: "native",
      ready: "native",
      processing: "native",
      tool: "native",
      waiting: "unsupported",
      error: "native",
      completed: "unsupported",
      interrupted: "unsupported",
      subagent: "unsupported",
    },
    eventMappings: facts(
      nativeFact("lifecycle", "session-start", "SessionStart"),
      nativeFact("lifecycle", "session-end", "SessionEnd"),
      nativeFact("ready", "stop", "Stop"),
      nativeFact("processing", "pre-prompt", "PromptSubmit"),
      nativeFact("processing", "post-tool", "ToolComplete"),
      nativeFact("tool", "pre-tool", "ToolStart"),
      nativeFact("error", "session-error", "error")
    ),
    upstream: sourceCommit(
      "https://autohand.dev/docs/hooks",
      "8595299fa7c2cb2f63715b03c48e39f26c6e2f7e"
    ),
  },
  cline: {
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
      subagent: "unsupported",
    },
    eventMappings: facts(
      nativeFact("lifecycle", "TaskStart", "SessionStart"),
      nativeFact("lifecycle", "SessionShutdown", "SessionEnd"),
      nativeFact("ready", "TaskComplete", "TurnCompleted"),
      nativeFact("processing", "UserPromptSubmit", "PromptSubmit"),
      nativeFact("processing", "TaskResume", "running"),
      nativeFact("processing", "PostToolUse", "ToolComplete"),
      nativeFact("tool", "PreToolUse", "ToolStart"),
      nativeFact("error", "TaskError", "error"),
      nativeFact("completed", "TaskComplete", "TurnCompleted"),
      nativeFact("interrupted", "TaskCancel", "TurnInterrupted")
    ),
    upstream: sourceCommit(
      "https://github.com/cline/cline/blob/main/sdk/packages/shared/src/hooks/events.ts",
      "912c4678180854399e9b20106311dd763396c775"
    ),
  },
  codebuff: {
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
    // print-mode/SDK 有稳定工具与子智能体事件；Pier 当前交互 TUI 启动链
    // 没有外部 command hook，接入需要 Task 4 决定 transport。
    upstream: sourceCommit(
      "https://github.com/CodebuffAI/codebuff/blob/main/common/src/types/print-mode.ts",
      "3e7ed540313d4b19b0673471fb559e2c2a6c7a6a"
    ),
  },
  "command-code": {
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
      nativeFact("control", "Stop", "Stop"),
      nativeFact("processing", "PostToolUse", "ToolComplete"),
      nativeFact("tool", "PreToolUse", "ToolStart")
    ),
    upstream: upstream(
      "https://commandcode.ai/docs/hooks",
      "Command Code hooks documentation"
    ),
  },
  continue: {
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
    // 固定提交完整扫描结果：fireHook.ts 定义了 Session/UserPrompt/Tool/Stop
    // 等触发函数，但 extensions/cli/src 内没有任何 importer 或调用点；
    // PermissionRequest/SubagentStart/SubagentStop 也只有类型声明。默认 cn TUI
    // 实际不发这些事件，不能仅凭配置加载器与类型定义安装空 hook。
    upstream: sourceCommit(
      "https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/extensions/cli/src/hooks/fireHook.ts",
      "5522c6f44ca0ac3528b37244818fbfa39b5af470"
    ),
  },
  "mistral-vibe": {
    integration: "active",
    transport: ["hook-command"],
    evidence: {
      lifecycle: "unsupported",
      ready: "unsupported",
      processing: "native",
      tool: "unsupported",
      waiting: "unsupported",
      error: "unsupported",
      completed: "unsupported",
      interrupted: "unsupported",
      subagent: "unsupported",
    },
    eventMappings: facts(
      nativeFact("control", "post_agent", "Stop"),
      nativeFact("processing", "pre_tool", "processing"),
      nativeFact("processing", "post_tool", "ToolComplete")
    ),
    upstream: sourceCommit(
      "https://github.com/mistralai/mistral-vibe/blob/89350a4064ca90e4732271dcc27688e5d684871d/vibe/core/hooks/models.py",
      "89350a4064ca90e4732271dcc27688e5d684871d"
    ),
  },
  "qwen-code": {
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
    upstream: upstream(
      "https://qwenlm.github.io/qwen-code-docs/en/users/features/hooks/",
      "Qwen Code hooks documentation"
    ),
  },
} as const satisfies Partial<Record<AgentKind, AgentStatusEvidence>>;
