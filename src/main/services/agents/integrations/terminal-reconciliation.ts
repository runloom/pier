import type { AgentHookEventPayload } from "@shared/contracts/agent-session.ts";
import { createCodexTranscriptReconciler } from "./codex-transcript-reconciler.ts";

/**
 * Agent 私有终态对账的统一宿主边界。foreground-activity 只投递已验收的
 * 规范事件，不感知 Codex transcript 路径、格式或 watcher 生命周期。
 */
export interface AgentTerminalReconciler {
  dispose(): void;
  observe(event: AgentHookEventPayload): Promise<void>;
  releasePanel(panelId: string, windowId?: string): void;
  releaseWindow(windowId: string): void;
  retainPanels(windowId: string, activePanelIds: readonly string[]): void;
}

export function createAgentTerminalReconciler(args: {
  onTerminalEvent: (event: AgentHookEventPayload) => void;
}): AgentTerminalReconciler {
  const codex = createCodexTranscriptReconciler(args);
  return {
    dispose: () => codex.dispose(),
    observe: (event) => codex.observe(event),
    releasePanel: (panelId, windowId) => codex.releasePanel(panelId, windowId),
    retainPanels: (windowId, activePanelIds) => {
      const active = new Set(activePanelIds);
      codex.releasePanelsWhere(
        (panelId, ownerWindowId) =>
          ownerWindowId === windowId && !active.has(panelId)
      );
    },
    releaseWindow: (windowId) => codex.releaseWindow(windowId),
  };
}
