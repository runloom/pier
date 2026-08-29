import type { HookScope } from "./entry.ts";

/**
 * hook scope 工作集账本原语（named/anonymous 工具、交互、子智能体计数的
 * 结算与清账）。回合语义归约在 turn-bookkeeping.ts；本模块只拥有账本
 * 数据结构的操作，不理解事件语义。
 */

export const MAX_SETTLED_IDS_PER_KIND = 256;

export interface TerminalRetiredWork {
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

export function clearActiveWork(
  scope: HookScope
): TerminalRetiredWork | undefined {
  const terminalRetiredWork = {
    interactionCount:
      scope.activeInteractionIds.size + scope.anonymousInteractionCount,
    subagentCount: scope.activeSubagentIds.size + scope.anonymousSubagentCount,
    toolCount: scope.activeToolIds.size + scope.anonymousToolCount,
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
  scope.activeSubagentIds.clear();
  scope.activeToolIds.clear();
  scope.anonymousInteractionCount = 0;
  scope.anonymousSubagentCount = 0;
  scope.anonymousToolCount = 0;
  scope.settledInteractionIds.clear();
  scope.settledSubagentIds.clear();
  scope.settledToolIds.clear();
  scope.subagentCount = 0;
  return terminalRetiredWork.interactionCount > 0 ||
    terminalRetiredWork.subagentCount > 0 ||
    terminalRetiredWork.toolCount > 0
    ? terminalRetiredWork
    : undefined;
}

export function hookScopeHasActiveTools(scope: HookScope): boolean {
  return scope.activeToolIds.size > 0 || scope.anonymousToolCount > 0;
}

export function hookScopeHasActiveInteractions(scope: HookScope): boolean {
  return (
    scope.activeInteractionIds.size > 0 || scope.anonymousInteractionCount > 0
  );
}
