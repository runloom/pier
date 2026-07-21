import { homedir } from "node:os";
import { join } from "node:path";
import { createUsagePollingRegistry } from "@pier/plugin-api/account-usage";
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
      context.plugin.version,
      context.logger
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
    // TTL-based lease registry: renderer leases carry per-mount unique ids
    // and renew on a heartbeat, so a reloaded/crashed window cannot leave
    // polling running forever, and two windows never share one lease entry.
    const usagePolling = createUsagePollingRegistry();
    const service = createGrokAccountsService({
      managedBaseDir,
      provider,
      stateStore,
      logger: context.logger,
      onChanged: (snapshot) =>
        context.events.emit("accounts.changed", snapshot),
      hasVisibleTarget: () => usagePolling.hasVisibleTarget(),
    });
    // Register RPC before init so renderer snapshot calls during boot/reload
    // do not hit "No RPC handler registered".
    registerGrokRpcHandlers({
      acquireUsagePolling: (consumerId) => {
        const { firstConsumer } = usagePolling.acquire(consumerId);
        if (firstConsumer) {
          service.refreshAllUsage().catch((error: unknown) => {
            context.logger.warn("[pier.grok] usage refresh failed", error);
          });
        }
        return Promise.resolve();
      },
      releaseUsagePolling: (consumerId) => {
        usagePolling.release(consumerId);
      },
      rpc: context.rpc,
      service,
    });
    await service.init();
    context.lifecycle.onBeforeQuit(() => service.flush());
    context.logger.info("[pier.grok] activated");
    return () => {
      usagePolling.clear();
      service.dispose();
    };
  },
};
