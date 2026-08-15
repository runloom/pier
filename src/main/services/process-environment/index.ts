export type {
  ApplyHostMode,
  ApplyHostProcessEnvOptions,
  ApplyHostProcessEnvResult,
} from "./apply-host-env.ts";
export {
  applyHostProcessEnv,
  pickHostApplyEnv,
  shouldApplyHostEnvKey,
} from "./apply-host-env.ts";
export {
  cleanEnv,
  mergeEnv,
  omitTerminalEmulatorEnv,
  TERMINAL_EMULATOR_ENV_KEYS,
} from "./clean-env.ts";
export type {
  ShellEnvFailureNotifyController,
  ShellEnvFailureNotifyDeps,
  ShellEnvUiLocale,
} from "./notify-failure.ts";
export {
  buildShellEnvFailureReport,
  createShellEnvFailureNotify,
  formatShellEnvFailureCopy,
  SHELL_ENV_FAILURE_DEDUPE_KEY,
  SHELL_ENV_FAILURE_DEDUPE_KEY_PREFIX,
  shellEnvFailureCopyKeys,
  shellEnvFailureDedupeKey,
} from "./notify-failure.ts";
export type { ResolveProjectEnvForSpawnInput } from "./resolve-project-env.ts";
export { resolveProjectEnvForSpawn } from "./resolve-project-env.ts";
export type {
  ResolvedUserCommand,
  ResolveUserCommandRequest,
} from "./resolve-user-command.ts";
export {
  agentShellCommandFlags,
  buildResolvedAgentSurfaceCommand,
  buildStickyExportPrelude,
  buildUserCommandProbeScript,
  clearUserCommandResolveCache,
  DETECT_COMMAND_RESOLVE_TIMEOUT_MS,
  extractBareCommandName,
  extractProbeProtocolBody,
  isAlreadyShellWrappedCommand,
  PANEL_COMMAND_RESOLVE_TIMEOUT_MS,
  PIER_CMD_END,
  PIER_CMD_START,
  parseUserCommandProbeOutput,
  quoteShellArg,
  resolveAbsoluteOnPath,
  resolveManyAbsoluteOnPath,
  resolveUserCommand,
  resolveWrapperShell,
  shellFamily,
} from "./resolve-user-command.ts";
export {
  createProcessEnvironmentService,
  stubProcessEnvironmentService,
} from "./service.ts";
export { isLaunchedFromCli } from "./shell-env-cli.ts";
export {
  createDefaultShellEnvironmentLoader,
  createShellEnvJsonMark,
  DEFAULT_SHELL_ENV_TIMEOUT_MS,
  FALLBACK_TIMEOUT_FLOOR_MS,
  fallbackDeadlineMs,
  fallbackTimeoutMs,
  PIER_RESOLVING_ENVIRONMENT,
  parseShellEnvironmentJsonOutput,
  parseShellEnvironmentOutput,
  remainingTimeoutMs,
  SHELL_DUMP_ARTIFACT_KEYS,
  SHELL_ENV_END,
  SHELL_ENV_START,
  shellEnvCommand,
  shellEnvJsonCommand,
  stripShellDumpArtifacts,
  tryParseShellEnvironmentOutput,
} from "./shell-env-loader.ts";
export type {
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
  ShellEnvSkipReason,
} from "./types.ts";
