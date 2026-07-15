import { homedir } from "node:os";
import { join } from "node:path";
import type { MainPluginModule } from "@pier/plugin-api/main";
import { createGrokAccountsService } from "./accounts-service.ts";
import { createGrokProvider } from "./grok-provider.ts";
import { registerGrokRpcHandlers } from "./rpc-handlers.ts";
import { createGrokAccountsStateStore } from "./state.ts";

export const plugin: MainPluginModule = {
  id: "pier.grok",
  async activate(context) {
    const stateStore = createGrokAccountsStateStore(
      join(context.paths.workDir, "accounts.json"),
      context.plugin.version
    );
    const provider = createGrokProvider({
      credentials: context.secrets,
      logger: context.logger,
      processEnv: context.processEnv,
      realGrokHome:
        context.processEnv.GROK_HOME ??
        process.env.GROK_HOME ??
        join(homedir(), ".grok"),
    });
    const managedBaseDir = join(context.paths.workDir, "runtime-homes");
    const usagePollingConsumers = new Set<string>();
    const service = createGrokAccountsService({
      managedBaseDir,
      provider,
      stateStore,
      logger: context.logger,
      onChanged: (snapshot) =>
        context.events.emit("accounts.changed", snapshot),
      hasVisibleTarget: () => usagePollingConsumers.size > 0,
    });
    // Register RPC before init so renderer snapshot calls during boot/reload
    // do not hit "No RPC handler registered".
    registerGrokRpcHandlers({
      acquireUsagePolling: (consumerId) => {
        const shouldRefresh = usagePollingConsumers.size === 0;
        usagePollingConsumers.add(consumerId);
        if (shouldRefresh) {
          service.refreshAllUsage().catch((error: unknown) => {
            context.logger.warn("[pier.grok] usage refresh failed", error);
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
    await service.init();
    context.lifecycle.onBeforeQuit(() => service.flush());
    context.logger.info("[pier.grok] activated");
    return () => {
      usagePollingConsumers.clear();
      service.dispose();
    };
  },
};
