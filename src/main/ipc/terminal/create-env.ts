import type { ResolvedTerminalLaunchOptions } from "@shared/contracts/terminal/launch.ts";
import type { ProcessEnvironmentService } from "../../services/process-environment-service.ts";

export interface ResolveRestoredAgentLaunchEnvOptions {
  clientEnv?: Record<string, string> | undefined;
  profileEnv?: Record<string, string> | undefined;
  projectEnv?: Record<string, string> | undefined;
}

/**
 * Re-hydrate shell (+ optional layers) for agent restore.
 * Session disk usually omits env; prior launch.env is defensive agentEnv only.
 * Never whole-table overwrite without merge layers.
 */
export async function resolveRestoredAgentLaunchEnv(
  launch: ResolvedTerminalLaunchOptions | undefined,
  processEnvironment: ProcessEnvironmentService,
  options: ResolveRestoredAgentLaunchEnvOptions = {}
): Promise<ResolvedTerminalLaunchOptions | undefined> {
  if (!launch) {
    return;
  }
  // Session restore often has no env; keep prior only when still in memory.
  const priorAgentEnv = launch.env;
  const resolved = await processEnvironment.resolve({
    cwd: launch.cwd,
    source: "agent",
    ...(options.clientEnv ? { clientEnv: options.clientEnv } : {}),
    ...(priorAgentEnv ? { agentEnv: priorAgentEnv } : {}),
    ...(options.profileEnv ? { profileEnv: options.profileEnv } : {}),
    ...(options.projectEnv ? { projectEnv: options.projectEnv } : {}),
  });
  return {
    ...launch,
    env: resolved.env,
  };
}
