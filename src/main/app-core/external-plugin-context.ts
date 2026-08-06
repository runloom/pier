/**
 * External main plugin context factory (env hydration + secrets/usage facades).
 */
import { join } from "node:path";
import { createLogger } from "@shared/logger.ts";
import type { ExternalMainPluginContext } from "../plugins/external-main-runtime.ts";
import { createExternalPluginProcessEnv } from "../plugins/external-plugin-process-env.ts";
import type { PluginRpcBus } from "../plugins/rpc-bus.ts";
import { createPluginSecretsFacade } from "../plugins/secrets.ts";
import { createCodexLegacyMigrationAdapter } from "../services/agent-accounts/legacy-migration-adapter.ts";
import { resolveUserCommand } from "../services/process-environment/resolve-user-command.ts";
import type { ProcessEnvironmentService } from "../services/process-environment-service.ts";
import type { createSecretsStore } from "../state/secrets-store.ts";
import type { createAppCoreUsageData } from "./usage-data.ts";

type SecretsStore = ReturnType<typeof createSecretsStore>;
type UsageData = ReturnType<typeof createAppCoreUsageData>["usageData"];

export function createExternalMainPluginContextFactory(deps: {
  managedPluginWorkDir: string;
  pluginRpcBus: PluginRpcBus;
  processEnvironment: ProcessEnvironmentService;
  secrets: SecretsStore;
  usageData: UsageData;
  userDataDir: string;
}): (source: {
  id: string;
  manifest: { permissions: readonly string[] };
  version: string;
}) => ExternalMainPluginContext {
  return (source) => ({
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
  });
}
