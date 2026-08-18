import type { ResolvedTerminalLaunchOptions } from "@shared/contracts/terminal/launch.ts";
import type { LocalEnvironmentService } from "../../services/local-environments-service.ts";
import { resolveProjectEnvForSpawn } from "../../services/process-environment/resolve-project-env.ts";
import type { ProcessEnvironmentService } from "../../services/process-environment-service.ts";

export interface ResolveRestoredAgentLaunchEnvOptions {
  clientEnv?: Record<string, string> | undefined;
  profileEnv?: Record<string, string> | undefined;
  projectEnv?: Record<string, string> | undefined;
}

export interface HydrateNativeLaunchEnvOptions {
  localEnvironments?:
    | Pick<LocalEnvironmentService, "resolveForWorktree" | "resolveProject">
    | null
    | undefined;
  projectRootPath?: string | undefined;
}

/**
 * Overlay login+interactive shell dump onto a native PTY launch.
 * Used for UI agent start, CLI `terminal.open`, and session restore.
 * Prior `launch.env` is agentEnv only (defaults / wrap PATH); never persist
 * the merged dump back to session disk.
 */
export async function resolveRestoredAgentLaunchEnv(
  launch: ResolvedTerminalLaunchOptions | undefined,
  processEnvironment: ProcessEnvironmentService,
  options: ResolveRestoredAgentLaunchEnvOptions = {}
): Promise<ResolvedTerminalLaunchOptions | undefined> {
  if (!launch) {
    return;
  }
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

/** Last-mile spawn hydrate: project KV + shell dump. Does not persist. */
export async function hydrateNativeLaunchEnv(
  launch: ResolvedTerminalLaunchOptions | undefined,
  processEnvironment: ProcessEnvironmentService,
  options: HydrateNativeLaunchEnvOptions = {}
): Promise<ResolvedTerminalLaunchOptions | undefined> {
  if (!launch) {
    return;
  }
  const projectEnv = options.localEnvironments
    ? await resolveProjectEnvForSpawn({
        cwd: launch.cwd,
        localEnvironments: options.localEnvironments,
        projectRootPath: options.projectRootPath,
      })
    : undefined;
  return resolveRestoredAgentLaunchEnv(launch, processEnvironment, {
    ...(projectEnv ? { projectEnv } : {}),
  });
}
