import { join } from "node:path";
import type {
  MainPluginContext,
  MainPluginModule,
} from "@pier/plugin-api/main";
import { createCodexAccountsService } from "./accounts-service.ts";
import { createCodexProvider } from "./codex-provider.ts";
import { createLocalUsageScanner } from "./local-usage-scanner.ts";
import { registerCodexRpcHandlers } from "./rpc-handlers.ts";
import { createCodexAccountsStateStore } from "./state.ts";

interface CodexPrivateMainPluginContext extends MainPluginContext {
  legacyCodexAccounts?: {
    readonly legacyAgentAccountsBaseDir: string;
    readonly legacyAgentAccountsStateFile: string;
    readLegacyAuthJson(accountId: string): Promise<string | null>;
    readLegacyStateFile(): Promise<string | null>;
  };
}

export const plugin: MainPluginModule = {
  id: "pier.codex",
  async activate(context: MainPluginContext): Promise<() => void> {
    const codexContext = context as CodexPrivateMainPluginContext;
    const stateStore = createCodexAccountsStateStore(
      join(context.paths.workDir, "accounts.json"),
      context.plugin.version
    );
    const provider = createCodexProvider({ credentials: context.secrets });
    const managedBaseDir = join(context.paths.workDir, "runtime-homes");
    const codexHome =
      context.processEnv.CODEX_HOME ??
      join(context.processEnv.HOME ?? context.paths.workDir, ".codex");
    const localUsageScanner = createLocalUsageScanner({
      cachePath: join(context.paths.workDir, "local-usage-cache.json"),
      codexHome,
    });
    const service = createCodexAccountsService({
      managedBaseDir,
      provider,
      stateStore,
      ...(codexContext.legacyCodexAccounts
        ? { legacyMigration: codexContext.legacyCodexAccounts }
        : {}),
      onChanged: (snapshot) =>
        context.events.emit("accounts.changed", snapshot),
    });
    await service.init();

    const cachedCostUsage = await context.usageData.read(
      "codex-local-sessions",
      { kind: "machine" }
    );
    if (cachedCostUsage) service.setCostUsage(cachedCostUsage);

    let localUsageRefresh: Promise<void> | null = null;
    function refreshLocalUsage(): Promise<void> {
      if (localUsageRefresh) return localUsageRefresh;
      localUsageRefresh = (async () => {
        const result = await localUsageScanner.scan();
        const snapshot = await context.usageData.publish(result.input);
        service.setCostUsage({ ...snapshot, diagnostics: result.diagnostics });
      })().finally(() => {
        localUsageRefresh = null;
      });
      return localUsageRefresh;
    }
    refreshLocalUsage().catch((error: unknown) => {
      context.logger.warn("[pier.codex] local usage scan failed", error);
    });

    registerCodexRpcHandlers({
      refreshLocalUsage,
      rpc: context.rpc,
      service,
    });
    context.lifecycle.onBeforeQuit(() => service.flush());
    context.logger.info("[pier.codex] activated");
    return () => {
      service.dispose();
    };
  },
};
