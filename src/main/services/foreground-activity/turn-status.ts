import type { ActivityStatus } from "@shared/contracts/foreground-activity.ts";
import { statusWithNativeIdle } from "./activity-idle.ts";
import type { AgentTurnEventSemantics } from "./agent-turn-event-semantics.ts";
import { statusWithDisplayQuestion } from "./display-question.ts";
import type { HookScope } from "./entry.ts";
import {
  hookScopeHasActiveInteractions,
  hookScopeHasActiveSubagents,
  hookScopeHasActiveTools,
} from "./turn-ledger.ts";

/**
 * 已封账回合的展示状态。
 *
 * 可信终态封账后仍可能有子工作在跑（Claude async agent 在父回合
 * assistant_stop 之后才结束，终端显示 “Waiting for N background agents”）。
 * 封账时的状态只是快照，必须按剩余子工作重算，否则子工作全部结束后
 * 状态永远停在 processing。
 */
export function statusForSealedTurn(scope: HookScope): ActivityStatus {
  if (scope.displayQuestionId) {
    return "waiting";
  }
  if (scope.terminalEvidence === "error") {
    return "error";
  }
  return hookScopeHasActiveSubagents(scope) ? "processing" : "ready";
}

/** 优先展示未完成工作；原生空闲事实可恢复 ready，但不推断回合结果。 */
export function nextStatusAfterTurnBookkeeping(
  scope: HookScope,
  semantics: AgentTurnEventSemantics
): ActivityStatus | undefined {
  if (scope.displayQuestionId) {
    return statusWithDisplayQuestion(scope, semantics, "waiting");
  }
  if (scope.turnEnded) {
    return statusForSealedTurn(scope);
  }
  if (hookScopeHasActiveInteractions(scope)) {
    return "waiting";
  }
  if (hookScopeHasActiveTools(scope)) {
    return "tool";
  }
  return statusWithNativeIdle(
    scope,
    semantics.category === "terminal-candidate"
      ? scope.status
      : (semantics.mappedStatus ?? undefined)
  );
}
