export { commandExistsOnPath } from "./command-path.ts";
// 兼容再导出：历史集成与测试从 shared 取 hook 命令原语。
export {
  isLegacyPierHttpHookCommand,
  isManagedPierHookCommand,
  isPierHookCommand,
  PIER_AGENT_HOOKS_DIR_MARK,
  PIER_HOOK_GEN_MARK,
  type PierHookCommandV3Spec,
  pierHookCommand,
  pierHookCommandGeneration,
  pierHookCommandV3,
  pierHookCommandV3ShellDispatched,
  skipHookCommandWhenEnvPresent,
} from "./hooks/command-core.ts";
// 兼容再导出：hook 配置 IO / 世代守卫（integrations/hooks/config.ts）。
export {
  atomicWriteFile,
  maxPierHookGenerationInSettings,
  readJsonConfig,
  transformJsonConfig,
  transformPierHooksUnlessNewer,
} from "./hooks/config.ts";
// 兼容再导出：Claude-schema 嵌套 hooks 工厂（integrations/hooks/nested.ts）。
export {
  createNestedJsonIntegration,
  DEFAULT_NESTED_HOOK_TIMEOUT,
  type NestedHookEventSpec,
  type NestedJsonIntegrationSpec,
  preflightPierNestedHooksInstall,
  resolveNestedHookTimeout,
  withoutPierNestedHooks,
  withPierNestedHooks,
} from "./hooks/nested.ts";
export {
  type PierHookCommandV3WithStdinSpec,
  pierClaudeUserPromptSubmitCommand,
  pierClaudeUserPromptSubmitCommandV3,
  pierHookCommandV3WithStdin,
  pierHookCommandV3WithStdinOutcomeDispatch,
  pierHookCommandV3WithStdinStatusDispatch,
  pierHookCommandV3WithStdinValueDispatch,
  pierHookCommandWithStdinSessionId,
  pierHookCommandWithStdinStatusDispatch,
  type StdinInteractionOutcomeDispatchCase,
  type StdinStatusDispatchCase,
  type StdinV3StatusDispatchSpec,
  type StdinV3ValueDispatchSpec,
  type StdinValueDispatchCase,
} from "./hooks/stdin-commands.ts";
export {
  type InteractiveToolResolveOutcome,
  pierHookCommandV3WithStdinInteractiveToolResolve,
  pierHookCommandV3WithStdinInteractiveToolStart,
  pierHookCommandV3WithStdinPermissionAcceptedThenToolStart,
  type StdinInteractiveToolDispatchSpec,
  type StdinInteractiveToolResolveSpec,
} from "./hooks/stdin-sequences.ts";
export type { InteractiveBlockingToolCase } from "./interactive-blocking-tools.ts";
export {
  type InteractiveBlockingToolLifecycleOptions,
  interactiveBlockingToolLifecycleEvents,
} from "./interactive-tool-lifecycle.ts";
export {
  pierBlockMarkers,
  pierTextBlockGeneration,
  removePierTextBlock,
  upsertPierTextBlock,
  upsertPierTextBlockUnlessNewer,
} from "./text-block.ts";
