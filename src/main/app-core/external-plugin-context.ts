import { join } from "node:path";
import type { LaunchWrapHandler } from "@pier/plugin-api/main";
import { jsonValueSchema } from "@shared/contracts/plugin/settings.ts";
import { createLogger } from "@shared/logger.ts";
import { effectiveConfigurationValue } from "@shared/plugin-settings.ts";
import type { ExternalMainPluginContext } from "../plugins/external-main-runtime.ts";
import { createExternalPluginProcessEnv } from "../plugins/external-plugin-process-env.ts";
import type { PluginRpcBus } from "../plugins/rpc-bus.ts";
import { createPluginSecretsFacade } from "../plugins/secrets.ts";
import { createCodexLegacyMigrationAdapter } from "../services/agent-accounts/legacy-migration-adapter.ts";
import type { ManagedPluginRuntimeSource } from "../services/managed-plugins/install-runtime.ts";
import type { PluginSettingsService } from "../services/plugin-settings-service.ts";
import { resolveUserCommand } from "../services/process-environment/resolve-user-command.ts";
import type { ProcessEnvironmentService } from "../services/process-environment-service.ts";
import {
  assertLaunchWrapCapability,
  registerLaunchWrapHandler,
} from "../services/terminal-launch-wrap/index.ts";
import type { createSecretsStore } from "../state/secrets-store.ts";
import type { createAppCoreUsageData } from "./usage-data.ts";

type SecretsStore = ReturnType<typeof createSecretsStore>;
type UsageData = ReturnType<typeof createAppCoreUsageData>["usageData"];

function assertOwnedConfigurationKey(pluginId: string, key: string): void {
  if (!key.startsWith(`${pluginId}.`)) {
    throw new Error(`plugin configuration key not owned: ${pluginId}:${key}`);
  }
}

export function createExternalMainPluginContextFactory(deps: {
  managedPluginWorkDir: string;
  pluginRpcBus: PluginRpcBus;
  pluginSettings: PluginSettingsService;
  processEnvironment: ProcessEnvironmentService;
  secrets: SecretsStore;
  usageData: UsageData;
  userDataDir: string;
}): (source: ManagedPluginRuntimeSource) => ExternalMainPluginContext {
  return (source) => ({
    configuration: {
      get: <T>(key: string): T => {
        const property = source.manifest.configuration?.properties[key];
        const userValue = deps.pluginSettings.getValues()[key];
        const value = property
          ? effectiveConfigurationValue(property, userValue)
          : userValue;
        return value as T;
      },
      onDidChange: (listener) =>
        deps.pluginSettings.onDidChange((payload) => {
          listener({ changedKeys: payload.changedKeys });
        }),
      reset: async (key) => {
        assertOwnedConfigurationKey(source.id, key);
        await deps.pluginSettings.reset(key);
      },
      set: async (key, value) => {
        assertOwnedConfigurationKey(source.id, key);
        const parsed = jsonValueSchema.safeParse(value);
        if (!parsed.success) {
          throw new Error(`invalid configuration value for ${key}`);
        }
        await deps.pluginSettings.set(key, parsed.data);
      },
    },
    events: {
      emit: (event, payload) =>
        deps.pluginRpcBus.emit(source.id, event, payload),
    },
    lifecycle: { onBeforeQuit: () => {} },
    ...(source.id === "pier.codex"
      ? {
          legacyCodexAccounts: createCodexLegacyMigrationAdapter({
            userDataDir: deps.userDataDir,
          }),
        }
      : {}),
    logger: createLogger(source.id),
    paths: {
      dataDir: deps.managedPluginWorkDir,
      workDir: join(deps.managedPluginWorkDir, source.id),
    },
    processEnv: createExternalPluginProcessEnv(),
    resolveProcessEnv: async (request = {}) => {
      const result = await deps.processEnvironment.resolve({
        ...(request.cwd ? { cwd: request.cwd } : {}),
        source: "plugin",
      });
      return {
        diagnostics: {
          cacheHit: result.diagnostics.cacheHit,
          ...(result.diagnostics.error
            ? { error: result.diagnostics.error }
            : {}),
          shellEnvStatus: result.diagnostics.shellEnvStatus,
        },
        env: result.env,
      };
    },
    resolveUserCommand: async (commandName, request = {}) => {
      const { env } = await deps.processEnvironment.resolve({
        ...(request.cwd ? { cwd: request.cwd } : {}),
        source: "plugin",
      });
      return await resolveUserCommand({
        commandName,
        cwd: request.cwd,
        env,
        shell: env.SHELL,
      });
    },
    plugin: { id: source.id, version: source.version },
    rpc: {
      handle: (method, handler) =>
        deps.pluginRpcBus.handle(source.id, method, handler),
    },
    secrets: createPluginSecretsFacade(deps.secrets, source.id, {
      read: source.manifest.permissions.includes("secret:read"),
      write: source.manifest.permissions.includes("secret:write"),
    }),
    usageData: deps.usageData.createPluginFacade(
      source.id,
      source.manifest.permissions.includes("usage:publish")
    ),
    launchWrap: {
      register: (handler: LaunchWrapHandler) => {
        assertLaunchWrapCapability(source.id, source.manifest.permissions);
        return registerLaunchWrapHandler(source.id, handler);
      },
    },
  });
}
