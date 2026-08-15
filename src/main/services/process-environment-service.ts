/**
 * Compatibility re-export. Prefer `@main/services/process-environment` (or
 * `./process-environment/index.ts`) for new code.
 */

export type {
  ApplyHostMode,
  ApplyHostProcessEnvOptions,
  ApplyHostProcessEnvResult,
  CreateProcessEnvironmentServiceOptions,
  Environment,
  HostAppliedStatus,
  ProcessEnvironmentDiagnostics,
  ProcessEnvironmentResolveRequest,
  ProcessEnvironmentResolveResult,
  ProcessEnvironmentService,
  ProcessEnvironmentSource,
  RawEnvironment,
  ShellEnvDumpMode,
  ShellEnvironmentLoader,
  ShellEnvironmentLoadRequest,
  ShellEnvironmentLoadResult,
} from "./process-environment/index.ts";
export {
  applyHostProcessEnv,
  cleanEnv,
  createDefaultShellEnvironmentLoader,
  createProcessEnvironmentService,
  DEFAULT_SHELL_ENV_TIMEOUT_MS,
  mergeEnv,
  omitTerminalEmulatorEnv,
  PIER_RESOLVING_ENVIRONMENT,
  parseShellEnvironmentOutput,
  pickHostApplyEnv,
  SHELL_ENV_END,
  SHELL_ENV_START,
  shellEnvCommand,
  shouldApplyHostEnvKey,
  stubProcessEnvironmentService,
  TERMINAL_EMULATOR_ENV_KEYS,
} from "./process-environment/index.ts";
