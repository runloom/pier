import { stubProcessEnvironmentService } from "@main/services/process-environment-service.ts";

/**
 * Create-path IPC tests must inject this. The default
 * `createProcessEnvironmentService()` dumps a real login shell and flakes
 * under parallel suites (5s timeout / ENOENT).
 */
export function stubTerminalIpcProcessEnvironment() {
  return stubProcessEnvironmentService(async (request) => ({
    diagnostics: {
      cacheHit: false,
      pathChanged: false,
      shellEnvStatus: "resolved",
      source: request.source,
    },
    env: {
      PATH: "/usr/bin",
      TERM: "xterm-256color",
      ...request.clientEnv,
      ...request.agentEnv,
      ...request.profileEnv,
      ...request.projectEnv,
      ...request.explicitEnv,
    },
    shellEnv: {},
  }));
}
