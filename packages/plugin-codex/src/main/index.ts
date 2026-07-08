import { join } from "node:path";
import type {
  MainPluginContext,
  MainPluginModule,
} from "@pier/plugin-api/main";
import type {
  AddAccountPayload,
  RemoveAccountPayload,
  SelectAccountPayload,
} from "../shared/accounts.ts";
import { createCodexAccountsService } from "./accounts-service.ts";
import { createCodexProvider } from "./codex-provider.ts";
import { createCodexAccountsStateStore } from "./state.ts";

interface CodexPrivateMainPluginContext extends MainPluginContext {
  legacyCodexAccounts?: {
    readonly legacyAgentAccountsBaseDir: string;
    readonly legacyAgentAccountsStateFile: string;
    readLegacyAuthJson(accountId: string): Promise<string | null>;
    readLegacySecretsStoreEntry(key: string): Promise<string | null>;
    readLegacyStateFile(): Promise<string | null>;
  };
}

export const plugin: MainPluginModule = {
  id: "pier.codex",
  activate(context: MainPluginContext): () => void {
    const codexContext = context as CodexPrivateMainPluginContext;
    const stateStore = createCodexAccountsStateStore(
      join(context.paths.workDir, "accounts.json")
    );
    const provider = createCodexProvider();
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
    service.init().catch((err: unknown) => {
      context.logger.error("[pier.codex] service init failed", err);
    });

    context.rpc.handle("accounts.snapshot", async () => service.snapshot());
    context.rpc.handle("accounts.add", async (payload) => {
      await service.add((payload ?? {}) as AddAccountPayload);
      return null;
    });
    context.rpc.handle("accounts.cancelLogin", async () => {
      await service.cancelLogin();
      return null;
    });
    context.rpc.handle("accounts.select", async (payload) => {
      await service.select(payload as SelectAccountPayload);
      return null;
    });
    context.rpc.handle("accounts.remove", async (payload) => {
      await service.remove(payload as RemoveAccountPayload);
      return null;
    });
    context.rpc.handle("accounts.refreshUsage", async () => {
      await service.refreshUsage(true);
      return null;
    });
    context.rpc.handle("accounts.adoptCurrent", async () => {
      await service.adoptCurrent();
      return null;
    });
    context.lifecycle.onBeforeQuit(() => service.flush());
    context.logger.info("[pier.codex] activated");
    return () => {
      service.dispose();
    };
  },
};
