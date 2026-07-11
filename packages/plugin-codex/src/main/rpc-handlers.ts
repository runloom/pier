import type { MainPluginContext } from "@pier/plugin-api/main";
import {
  addAccountPayloadSchema,
  emptyRpcPayloadSchema,
  refreshUsagePayloadSchema,
  removeAccountPayloadSchema,
  selectAccountPayloadSchema,
} from "../shared/accounts.ts";
import type { CodexAccountsService } from "./accounts-service-contract.ts";

export function registerCodexRpcHandlers(options: {
  refreshLocalUsage: () => Promise<void>;
  rpc: MainPluginContext["rpc"];
  service: CodexAccountsService;
}): void {
  const { refreshLocalUsage, rpc, service } = options;
  rpc.handle("accounts.snapshot", async (payload) => {
    emptyRpcPayloadSchema.parse(payload);
    return service.snapshot();
  });
  rpc.handle("accounts.add", async (payload) => {
    await service.add(addAccountPayloadSchema.parse(payload));
    return null;
  });
  rpc.handle("accounts.cancelLogin", async (payload) => {
    emptyRpcPayloadSchema.parse(payload);
    await service.cancelLogin();
    return null;
  });
  rpc.handle("accounts.select", async (payload) => {
    await service.select(selectAccountPayloadSchema.parse(payload));
    return null;
  });
  rpc.handle("accounts.remove", async (payload) => {
    await service.remove(removeAccountPayloadSchema.parse(payload));
    return null;
  });
  rpc.handle("accounts.refreshUsage", async (payload) => {
    const request = refreshUsagePayloadSchema.parse(payload ?? {});
    await service.refreshUsage({
      ...(request.accountId ? { accountId: request.accountId } : {}),
      force: true,
    });
    return null;
  });
  rpc.handle("usage.refreshCost", async (payload) => {
    emptyRpcPayloadSchema.parse(payload);
    await refreshLocalUsage();
    return null;
  });
}
