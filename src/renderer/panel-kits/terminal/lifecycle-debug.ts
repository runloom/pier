import type {
  TerminalDebugRendererTerminalLifecycleSnapshot,
  TerminalDebugRendererTerminalPhase,
} from "@shared/contracts/terminal/debug.ts";

export type TerminalLifecycleDebugPatch = Partial<
  Omit<TerminalDebugRendererTerminalLifecycleSnapshot, "updatedAt">
>;

const lifecycleByPanelId = new Map<
  string,
  TerminalDebugRendererTerminalLifecycleSnapshot
>();

function now(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function defaultLifecycle(
  phase: TerminalDebugRendererTerminalPhase
): TerminalDebugRendererTerminalLifecycleSnapshot {
  return {
    createAttemptCount: 0,
    createPending: false,
    didCreateNativeTerminal: false,
    error: null,
    hasRenderableAnchor: false,
    nativeTerminalReady: false,
    phase,
    placeholderVisible: true,
    presentationId: null,
    updatedAt: now(),
  };
}

export function readTerminalPanelLifecycleDebug(
  panelId: string
): TerminalDebugRendererTerminalLifecycleSnapshot | undefined {
  return lifecycleByPanelId.get(panelId);
}

export function updateTerminalPanelLifecycleDebug(
  panelId: string,
  patch: TerminalLifecycleDebugPatch
): void {
  const previous =
    lifecycleByPanelId.get(panelId) ?? defaultLifecycle("mounted");
  lifecycleByPanelId.set(panelId, {
    ...previous,
    ...patch,
    updatedAt: now(),
  });
}

/**
 * 面板生命周期结束即释放条目：debug 快照只读取仍在 dockview 中的 panel，
 * 保留「disposed」条目只会让 Map 随历史面板数无界增长。
 */
export function disposeTerminalPanelLifecycleDebug(panelId: string): void {
  lifecycleByPanelId.delete(panelId);
}

export function resetTerminalPanelLifecycleDebugForTests(): void {
  lifecycleByPanelId.clear();
}
