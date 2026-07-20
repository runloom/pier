import { join } from "node:path";
import { createUsagePollingRegistry } from "@pier/plugin-api/account-usage";
import type { MainPluginModule } from "@pier/plugin-api/main";
import { createClaudeAccountsService } from "./accounts-service.ts";
import { createClaudeProvider } from "./claude-provider.ts";
import { registerClaudeRpcHandlers } from "./rpc-handlers.ts";
import { createClaudeAccountsStateStore } from "./state.ts";

export const plugin: MainPluginModule = {
  id: "pier.claude",
  async activate(context) {
    const stateStore = createClaudeAccountsStateStore(
      join(context.paths.workDir, "accounts.json"),
      context.plugin.version,
      context.logger
    );
    const provider = createClaudeProvider({
      credentials: context.secrets,
      logger: context.logger,
      processEnv: context.processEnv,
    });
    const managedBaseDir = join(context.paths.workDir, "runtime-homes");
    // TTL-based lease registry: renderer leases carry per-mount unique ids
    // and renew on a heartbeat, so a reloaded/crashed window cannot leave
    // polling running forever (mirrors Codex/Grok).
    const usagePolling = createUsagePollingRegistry();
    const service = createClaudeAccountsService({
      hasVisibleTarget: () => usagePolling.hasVisibleTarget(),
      logger: context.logger,
      managedBaseDir,
      onChanged: (snapshot) =>
        context.events.emit("accounts.changed", snapshot),
      provider,
      stateStore,
    });
    // Register RPC before init so renderer snapshot calls during boot/reload
    // do not hit "No RPC handler registered".
    registerClaudeRpcHandlers({
      acquireUsagePolling: (consumerId) => {
        const { firstConsumer } = usagePolling.acquire(consumerId);
        if (firstConsumer) {
          service.refreshAllUsage().catch((error: unknown) => {
            context.logger.warn("[pier.claude] usage refresh failed", error);
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
    context.logger.info("[pier.claude] activated");
    return () => {
      usagePolling.clear();
      service.dispose();
    };
  },
};
