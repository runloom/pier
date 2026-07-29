import type { TerminalPanelTransfer } from "../services/panel-transfer/terminal-panel-transfer.ts";
import type { ManagedAgentLaunchGate } from "../services/project-skills/launch-gate.ts";

export type TerminalTransferCreateAction = "proceed" | "skip" | "adopt";

/**
 * Panel-transfer create disposition for this window/panel.
 * Call again after any await (skills gate) — lease state can change mid-flight.
 */
export function resolveTerminalTransferCreateAction(
  transfer: TerminalPanelTransfer | null,
  runtimeWindowId: string | undefined,
  panelId: string
): TerminalTransferCreateAction {
  if (!(transfer && runtimeWindowId)) {
    return "proceed";
  }
  if (transfer.shouldSkipTargetCreate(runtimeWindowId, panelId)) {
    return "skip";
  }
  if (transfer.shouldAdoptMovedSurface(runtimeWindowId, panelId)) {
    return "adopt";
  }
  return "proceed";
}

export async function abandonAuthorizedSpawnAttempt(args: {
  attemptId: string | null;
  launchGate: ManagedAgentLaunchGate | null | undefined;
}): Promise<void> {
  const { attemptId, launchGate } = args;
  if (!(attemptId && launchGate)) {
    return;
  }
  await launchGate.recordSpawnResult(attemptId, false).catch(() => undefined);
}
