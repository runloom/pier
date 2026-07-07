import type {
  TerminalDebugRendererTerminalLifecycleSnapshot,
  TerminalDebugRendererTerminalPhase,
} from "@shared/contracts/terminal-debug.ts";

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

export function disposeTerminalPanelLifecycleDebug(panelId: string): void {
  updateTerminalPanelLifecycleDebug(panelId, {
    createPending: false,
    phase: "disposed",
    placeholderVisible: false,
  });
}

export function resetTerminalPanelLifecycleDebugForTests(): void {
  lifecycleByPanelId.clear();
}
