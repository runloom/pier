import type { HookScope } from "./entry.ts";

/**
 * hook scope 工作集账本原语（named/anonymous 工具、交互、子智能体计数的
 * 结算与清账）。回合语义归约在 turn-bookkeeping.ts；本模块只拥有账本
 * 数据结构的操作，不理解事件语义。
 */

export const MAX_SETTLED_IDS_PER_KIND = 256;

export interface TerminalRetiredWork {
  /** 封账后继续运行、未退休的子工作数量；仅 `keepSubagents` 路径出现。 */
  carriedSubagentCount?: number;
  interactionCount: number;
  subagentCount: number;
  toolCount: number;
}

export function reopenNamedWork(settledIds: Set<string>, id: string): void {
  settledIds.delete(id);
}

export function settleNamedWork(
  settledIds: Set<string>,
  id: string,
  markHistoryIncomplete?: () => void
): boolean {
  if (settledIds.has(id)) {
    return false;
  }
  settledIds.add(id);
  if (settledIds.size > MAX_SETTLED_IDS_PER_KIND) {
    const oldestId = settledIds.values().next().value;
    if (oldestId !== undefined) {
      settledIds.delete(oldestId);
      markHistoryIncomplete?.();
    }
  }
  return true;
}

/**
 * 退休回合工作集。
 *
 * `keepSubagents` 用于可信终态封账：Claude 的 async 子智能体在父回合 Stop /
 * assistant_stop 之后才结束（终端显示 “Waiting for N background agents”），
 * 退休它们会让状态退回 ready，子工作结束也再没有账可结算。工具与交互属于
 * 该回合本身，仍照常退休。
 */
function retireWork(
  scope: HookScope,
  keepSubagents: boolean
): TerminalRetiredWork | undefined {
  const activeSubagentCount =
    scope.activeSubagentIds.size + scope.anonymousSubagentCount;
  const carriedSubagentCount =
    keepSubagents && activeSubagentCount > 0 ? activeSubagentCount : undefined;
  const terminalRetiredWork = {
    interactionCount:
      scope.activeInteractionIds.size + scope.anonymousInteractionCount,
    subagentCount: carriedSubagentCount === undefined ? activeSubagentCount : 0,
    toolCount: scope.activeToolIds.size + scope.anonymousToolCount,
    ...(carriedSubagentCount === undefined ? {} : { carriedSubagentCount }),
  };
  if (
    scope.activeInteractionIds.size > 0 ||
    scope.anonymousInteractionCount > 0 ||
    scope.settledInteractionIds.size > 0
  ) {
    scope.interactionHistoryIncomplete = true;
  }
  if (
    scope.activeToolIds.size > 0 ||
    scope.anonymousToolCount > 0 ||
    scope.settledToolIds.size > 0
  ) {
    scope.toolHistoryIncomplete = true;
  }
  scope.activeInteractionIds.clear();
  scope.activePlanInteractionIds.clear();
  scope.activeToolIds.clear();
  scope.anonymousInteractionCount = 0;
  scope.anonymousToolCount = 0;
  scope.settledInteractionIds.clear();
  scope.settledToolIds.clear();
  if (carriedSubagentCount === undefined) {
    scope.activeSubagentIds.clear();
    scope.anonymousSubagentCount = 0;
    scope.settledSubagentIds.clear();
  }
  scope.subagentCount = carriedSubagentCount ?? 0;
  return terminalRetiredWork.interactionCount > 0 ||
    terminalRetiredWork.subagentCount > 0 ||
    terminalRetiredWork.toolCount > 0 ||
    carriedSubagentCount !== undefined
    ? terminalRetiredWork
    : undefined;
}

export function clearActiveWork(
  scope: HookScope
): TerminalRetiredWork | undefined {
  return retireWork(scope, false);
}

/** 可信终态封账：退休工具与交互，保留仍在运行的子工作账。 */
export function retireTurnWorkKeepingSubagents(
  scope: HookScope
): TerminalRetiredWork | undefined {
  return retireWork(scope, true);
}

export function hookScopeHasActiveSubagents(scope: HookScope): boolean {
  return scope.activeSubagentIds.size + scope.anonymousSubagentCount > 0;
}

export function hookScopeHasActiveTools(scope: HookScope): boolean {
  return scope.activeToolIds.size > 0 || scope.anonymousToolCount > 0;
}

export function hookScopeHasActiveInteractions(scope: HookScope): boolean {
  return (
    scope.activeInteractionIds.size > 0 || scope.anonymousInteractionCount > 0
  );
}
