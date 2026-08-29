/**
 * 阻塞等人工具 catalog + lifecycle 接线。
 *
 * 领域类型与工具名单归本文件；hook 命令构造见 hooks/stdin-sequences.ts。
 * interactionKind 槽位复用契约枚举：plan 审批门用 `permission`（用户批准后
 * 才继续），问卷用 `question`。不是「整类 PermissionRequest 事件」。
 */

/** plan 审批 / 问卷等阻塞工具 → Interaction* 映射条目。 */
export interface InteractiveBlockingToolCase {
  /**
   * `permission`：审批门（enter/exit plan 等）。
   * `question`：问卷/澄清。
   * `external-block`：外部阻塞（预留）。
   */
  interactionKind: "permission" | "question" | "external-block";
  /** 精确工具名（可多别名）；须全部为 shell 安全标识符。 */
  toolNames: readonly string[];
}

/**
 * Claude Code / OpenClaude 同构阻塞等人工具。
 *
 * 依据：
 * - 官方 plan 模式：https://code.claude.com/docs/en/permission-modes
 * - 官方 hooks：https://code.claude.com/docs/en/hooks
 * - OpenClaude 源码（工具名 + ExitPlanMode 需用户确认）：
 *   https://github.com/Gitlawb/openclaude/blob/main/src/tools/ExitPlanModeTool/constants.ts
 *   https://github.com/Gitlawb/openclaude/blob/main/src/tools/EnterPlanModeTool/constants.ts
 *   https://github.com/Gitlawb/openclaude/blob/main/src/tools/AskUserQuestionTool/prompt.ts
 *   https://github.com/Gitlawb/openclaude/blob/main/src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts
 */
export const CLAUDE_FAMILY_INTERACTIVE_BLOCKING_TOOLS = [
  {
    interactionKind: "permission",
    toolNames: ["EnterPlanMode", "ExitPlanMode"],
  },
  {
    interactionKind: "question",
    toolNames: ["AskUserQuestion"],
  },
] as const satisfies readonly InteractiveBlockingToolCase[];

/**
 * Grok Build 阻塞等人工具。
 *
 * 依据（本机 `~/.grok/docs` + https://x.ai/cli）：
 * - Plan：user-guide/19-plan-mode.md — enter/exit_plan_mode
 * - 问卷：hook Post 可能在 UI 画出时就响，waiting 只走 updates.jsonl
 */
export const GROK_INTERACTIVE_BLOCKING_TOOLS = [
  {
    interactionKind: "permission",
    toolNames: ["enter_plan_mode", "exit_plan_mode"],
  },
] as const satisfies readonly InteractiveBlockingToolCase[];

/**
 * Cursor 阻塞等人工具。AskQuestion 不走 hook（上游 preToolUse 不覆盖），
 * 问卷只由 transcript 对账。CreatePlan / SwitchMode 若触发 preToolUse，
 * 按审批门分发，避免方案卡停在「执行工具中」。
 */
export const CURSOR_INTERACTIVE_BLOCKING_TOOLS = [
  {
    interactionKind: "permission",
    toolNames: ["CreatePlan", "SwitchMode"],
  },
] as const satisfies readonly InteractiveBlockingToolCase[];

/**
 * Cursor 子智能体派发工具（一手证据：cursor-agent 2026.08.25 bundle +
 * 2026-08-29 events.jsonl 实测）：
 *
 * - `Task` 的 preToolUse 带**主 conversation_id + 子智能体自己的
 *   generation_id**（外来 turnId），且上游**从不发 postToolUse**——按普通
 *   ToolStart 记账会以外来 turnId 抢占主回合（resetTurn 把真回合提前打入
 *   settled），随后真正的 `stop` 终态被 settled-turn 拒收，面板钉死在
 *   「执行工具中」。
 * - 语义上 Task 就是子智能体派发（bundle 内 claude 兼容映射 `Task:"Task"`；
 *   原生 subagentStart/subagentStop hook 在当前版本实测不触发），因此按
 *   SubagentStart/SubagentStop 记账：只计数、不改父状态、不携带 turnId，
 *   未闭合计数由回合可信终态统一退休。
 */
export const CURSOR_SUBAGENT_DISPATCH_TOOLS = ["Task"] as const;
