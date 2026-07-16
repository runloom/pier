import { join } from "node:path";
import type {
  MainPluginContext,
  MainPluginModule,
} from "@pier/plugin-api/main";
import { createCodexAccountsService } from "./accounts-service.ts";
import { createCodexProvider } from "./codex-provider.ts";
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
    const provider = createCodexProvider({
      credentials: context.secrets,
      logger: context.logger,
    });
    const managedBaseDir = join(context.paths.workDir, "runtime-homes");
    const usagePollingConsumers = new Set<string>();
    const service = createCodexAccountsService({
      hasVisibleTarget: () => usagePollingConsumers.size > 0,
      logger: context.logger,
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

    registerCodexRpcHandlers({
      acquireUsagePolling: (consumerId) => {
        const shouldRefresh = usagePollingConsumers.size === 0;
        usagePollingConsumers.add(consumerId);
        if (shouldRefresh) {
          service.refreshAllUsage().catch((error: unknown) => {
            context.logger.warn("[pier.codex] usage refresh failed", error);
          });
        }
        return Promise.resolve();
      },
      releaseUsagePolling: (consumerId) => {
        usagePollingConsumers.delete(consumerId);
      },
      rpc: context.rpc,
      service,
    });
    context.lifecycle.onBeforeQuit(() => service.flush());
    context.logger.info("[pier.codex] activated");
    return () => {
      usagePollingConsumers.clear();
      service.dispose();
    };
  },
};
