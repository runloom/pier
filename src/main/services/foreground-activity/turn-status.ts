import type { ActivityStatus } from "@shared/contracts/foreground-activity.ts";
import { statusWithNativeIdle } from "./activity-idle.ts";
import type { AgentTurnEventSemantics } from "./agent-turn-event-semantics.ts";
import { statusWithDisplayQuestion } from "./display-question.ts";
import type { HookScope } from "./entry.ts";
import {
  hookScopeHasActiveInteractions,
  hookScopeHasActiveTools,
} from "./turn-ledger.ts";

/** 优先展示未完成工作；原生空闲事实可恢复 ready，但不推断回合结果。 */
export function nextStatusAfterTurnBookkeeping(
  scope: HookScope,
  semantics: AgentTurnEventSemantics
): ActivityStatus | undefined {
  if (scope.displayQuestionId) {
    return statusWithDisplayQuestion(scope, semantics, "waiting");
  }
  if (scope.turnEnded) {
    return scope.terminalEvidence === "error" ? "error" : "ready";
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
