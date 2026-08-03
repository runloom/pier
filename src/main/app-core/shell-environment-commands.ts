/**
 * shellEnvironment.* command payload builders (file-size split from command-router).
 */
import type { ShellEnvironmentHostStatus } from "@shared/contracts/shell-environment.ts";
import type { ProcessEnvironmentDiagnostics } from "../services/process-environment/types.ts";

export function buildShellEnvironmentHostStatus(input: {
  diagnostics?: ProcessEnvironmentDiagnostics | undefined;
  disabled: boolean;
  fallbackStatus?: ShellEnvironmentHostStatus["shellEnvStatus"];
  timeoutMs: number;
}): ShellEnvironmentHostStatus {
  const { diagnostics, disabled, fallbackStatus, timeoutMs } = input;
  const base: ShellEnvironmentHostStatus = {
    disabled,
    platform: process.platform,
    timeoutMs,
  };
  if (!diagnostics) {
    if (fallbackStatus) {
      return { ...base, shellEnvStatus: fallbackStatus };
    }
    return base;
  }
  return {
    ...base,
    cacheHit: diagnostics.cacheHit,
    ...(diagnostics.cwd ? { cwd: diagnostics.cwd } : {}),
    ...(diagnostics.dumpMode ? { dumpMode: diagnostics.dumpMode } : {}),
    ...(diagnostics.error ? { error: diagnostics.error } : {}),
    ...(diagnostics.hostAppliedStatus
      ? { hostAppliedStatus: diagnostics.hostAppliedStatus }
      : {}),
    pathChanged: diagnostics.pathChanged,
    ...(diagnostics.shell ? { shell: diagnostics.shell } : {}),
    shellEnvStatus: diagnostics.shellEnvStatus,
  };
}
