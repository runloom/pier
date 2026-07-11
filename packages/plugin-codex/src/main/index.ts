import { join } from "node:path";
import type {
  MainPluginContext,
  MainPluginModule,
} from "@pier/plugin-api/main";
import {
  addAccountPayloadSchema,
  emptyRpcPayloadSchema,
  refreshUsagePayloadSchema,
  removeAccountPayloadSchema,
  selectAccountPayloadSchema,
} from "../shared/accounts.ts";
import { createCodexAccountsService } from "./accounts-service.ts";
import { createCodexProvider } from "./codex-provider.ts";
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

    context.rpc.handle("accounts.snapshot", async (payload) => {
      emptyRpcPayloadSchema.parse(payload);
      return service.snapshot();
    });
    context.rpc.handle("accounts.add", async (payload) => {
      await service.add(addAccountPayloadSchema.parse(payload));
      return null;
    });
    context.rpc.handle("accounts.cancelLogin", async (payload) => {
      emptyRpcPayloadSchema.parse(payload);
      await service.cancelLogin();
      return null;
    });
    context.rpc.handle("accounts.select", async (payload) => {
      await service.select(selectAccountPayloadSchema.parse(payload));
      return null;
    });
    context.rpc.handle("accounts.remove", async (payload) => {
      await service.remove(removeAccountPayloadSchema.parse(payload));
      return null;
    });
    context.rpc.handle("accounts.refreshUsage", async (payload) => {
      const request = refreshUsagePayloadSchema.parse(payload ?? {});
      await service.refreshUsage({
        ...(request.accountId ? { accountId: request.accountId } : {}),
        force: true,
      });
      return null;
    });
    context.lifecycle.onBeforeQuit(() => service.flush());
    context.logger.info("[pier.codex] activated");
    return () => {
      service.dispose();
    };
  },
};
