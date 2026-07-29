/**
 * @deprecated EndState store 替代 latch Map。
 * 保留极薄兼容 re-export，供未迁移测试过渡；新代码请用
 * `useTerminalEndStateStore` / `terminalEndStateForPanel`。
 */
import type { AgentKind } from "@shared/contracts/agent.ts";
import {
  resetTerminalEndStateStoreForTests,
  terminalEndStateForPanel,
  useTerminalEndStateStore,
} from "@/stores/terminal-end-state.store.ts";

/** @deprecated */
export function noteAgentResultPanel(
  panelId: string,
  agentId: AgentKind
): void {
  useTerminalEndStateStore.getState().upsertAgentEnd({
    agentId,
    panelId,
  });
}

/** @deprecated */
export function noteAgentResultExited(
  panelId: string,
  exitCode?: number
): void {
  const prev = terminalEndStateForPanel(panelId);
  if (!prev?.agentId) {
    return;
  }
  useTerminalEndStateStore.getState().upsertAgentEnd({
    agentId: prev.agentId,
    ...(exitCode === undefined ? {} : { exitCode }),
    panelId,
  });
}

/** @deprecated */
export function clearAgentResultPanel(panelId: string): void {
  useTerminalEndStateStore.getState().clear(panelId);
}

/** @deprecated */
export function isLatchedAgentResultPanel(panelId: string): boolean {
  return terminalEndStateForPanel(panelId) != null;
}

/** @deprecated */
export function latchedAgentIdForPanel(panelId: string): AgentKind | undefined {
  return terminalEndStateForPanel(panelId)?.agentId;
}

/** @deprecated */
export function latchedAgentExitForPanel(
  panelId: string
): { exitCode?: number } | undefined {
  const end = terminalEndStateForPanel(panelId);
  if (!end) {
    return;
  }
  return end.exitCode === undefined ? {} : { exitCode: end.exitCode };
}

/** @deprecated */
export function resetAgentResultPanelLatchForTests(): void {
  resetTerminalEndStateStoreForTests();
}
