import type { ResolvedTerminalLaunchOptions } from "@shared/contracts/terminal-launch.ts";
import type { ProcessEnvironmentService } from "../services/process-environment-service.ts";

export async function resolveRestoredAgentLaunchEnv(
  launch: ResolvedTerminalLaunchOptions | undefined,
  processEnvironment: ProcessEnvironmentService
): Promise<ResolvedTerminalLaunchOptions | undefined> {
  if (!launch) {
    return;
  }
  const resolved = await processEnvironment.resolve({
    cwd: launch.cwd,
    source: "agent",
  });
  return {
    ...launch,
    ...(Object.keys(resolved.env).length > 0 ? { env: resolved.env } : {}),
  };
}
