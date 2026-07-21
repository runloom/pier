import type { AgentHookEventPayload } from "@shared/contracts/agent-session.ts";
import { createClaudeTranscriptReconciler } from "./claude-transcript-reconciler.ts";
import { createCodexTranscriptReconciler } from "./codex-transcript-reconciler.ts";
import type { TranscriptTailReconciler } from "./transcript-tail-reconciler.ts";

/**
 * Agent 私有终态对账的统一宿主边界。foreground-activity 只投递已验收的
 * 规范事件，不感知各 provider transcript 路径、格式或 watcher 生命周期。
 * 当前接入：Codex（task_complete / turn_aborted）、Claude（中断标记）。
 */
export interface AgentTerminalReconciler {
  dispose(): void;
  observe(event: AgentHookEventPayload): Promise<void>;
  releasePanel(panelId: string, windowId?: string): void;
  releaseWindow(windowId: string): void;
  retainPanels(windowId: string, activePanelIds: readonly string[]): void;
  transferPanelOwnership(input: {
    panelId: string;
    sourceWindowId: string;
    targetWindowId: string;
  }): void;
}

export function createAgentTerminalReconciler(args: {
  onTerminalEvent: (event: AgentHookEventPayload) => void;
}): AgentTerminalReconciler {
  const reconcilers: readonly TranscriptTailReconciler[] = [
    createCodexTranscriptReconciler(args),
    createClaudeTranscriptReconciler(args),
  ];
  return {
    dispose: () => {
      for (const reconciler of reconcilers) reconciler.dispose();
    },
    observe: async (event) => {
      // 每个对账器自行按 agent 过滤；非本 agent 的事件是 O(1) 直返。
      await Promise.all(
        reconcilers.map((reconciler) => reconciler.observe(event))
      );
    },
    releasePanel: (panelId, windowId) => {
      for (const reconciler of reconcilers) {
        reconciler.releasePanel(panelId, windowId);
      }
    },
    retainPanels: (windowId, activePanelIds) => {
      const active = new Set(activePanelIds);
      for (const reconciler of reconcilers) {
        reconciler.releasePanelsWhere(
          (panelId, ownerWindowId) =>
            ownerWindowId === windowId && !active.has(panelId)
        );
      }
    },
    releaseWindow: (windowId) => {
      for (const reconciler of reconcilers) reconciler.releaseWindow(windowId);
    },
    transferPanelOwnership: (input) => {
      for (const reconciler of reconcilers) {
        reconciler.transferPanelOwnership(input);
      }
    },
  };
}
