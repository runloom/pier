/**
 * Plan 审批门：provider 可能丢掉 Post。再次出示、后续普通 ToolStart，
 * 或具名非 plan 交互会结算未闭环条目。不要把普通权限/问卷加进此表。
 */
export const PLAN_APPROVAL_TOOL_NAMES: ReadonlySet<string> = new Set([
  "EnterPlanMode",
  "ExitPlanMode",
  "enter_plan_mode",
  "exit_plan_mode",
]);

/**
 * 阻塞问卷/权限闸。仅 ToolStart 时按 waiting 且可被普通工具顶替；
 * 具名非 plan InteractionRequested 之后不可顶替。
 */
export const QUESTION_TOOL_NAMES: ReadonlySet<string> = new Set([
  "AskUserQuestion",
  "ask_user_question",
  "ask_user",
  "ask",
  "clarify",
  "request_user_input",
  "request_permissions",
]);

export function isPlanApprovalToolName(toolName: string | undefined): boolean {
  return Boolean(toolName && PLAN_APPROVAL_TOOL_NAMES.has(toolName));
}

export function isQuestionToolName(toolName: string | undefined): boolean {
  return Boolean(toolName && QUESTION_TOOL_NAMES.has(toolName));
}

export function isInteractiveBlockingToolName(
  toolName: string | undefined
): boolean {
  return isPlanApprovalToolName(toolName) || isQuestionToolName(toolName);
}
