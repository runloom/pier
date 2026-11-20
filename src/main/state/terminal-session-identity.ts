/** Session-side lifecycle identity shared by transfer and exit bookkeeping. */

import type { TerminalPanelSession } from "./terminal-session-state-schemas.ts";

/**
 * Session counterpart of the live panel lifecycle: task run id, else agent
 * spawn generation, else "" (shells and agent rows without a recorded
 * generation). Must stay in lockstep with `resolveAgentSpawnLifecycle`
 * (create-launch.ts) and `nativeTerminalProcesses.begin` (process/registry.ts)
 * — tests/unit/main/terminal/lifecycle/transfer-identity-governance.test.ts
 * pins the three mappings together.
 */
export function terminalSessionLifecycleId(
  session: TerminalPanelSession
): string {
  if (session.task?.runId) {
    return session.task.runId;
  }
  const generation = session.agent?.restore?.spawnGeneration;
  return generation === undefined ? "" : String(generation);
}

/**
 * Live registry lifecycle → session-side identity. Shells are the only surface
 * whose live id (`shell:<generation>`) never appears in session metadata.
 */
export function sessionIdentityForLiveLifecycle(lifecycleId: string): string {
  return lifecycleId.startsWith("shell:") ? "" : lifecycleId;
}
