import type { MainPluginContext } from "@pier/plugin-api/main";
import {
  addAccountPayloadSchema,
  completeLoginPayloadSchema,
  emptyRpcPayloadSchema,
  refreshUsagePayloadSchema,
  removeAccountPayloadSchema,
  selectAccountPayloadSchema,
  usagePollingPayloadSchema,
} from "../shared/accounts.ts";
import type { ClaudeAccountsService } from "./accounts-service-contract.ts";

export function registerClaudeRpcHandlers(options: {
  acquireUsagePolling: (consumerId: string) => Promise<void>;
  releaseUsagePolling: (consumerId: string) => void;
  rpc: MainPluginContext["rpc"];
  service: ClaudeAccountsService;
}): void {
  const { acquireUsagePolling, releaseUsagePolling, rpc, service } = options;

  rpc.handle("accounts.snapshot", async (payload) => {
    emptyRpcPayloadSchema.parse(payload);
    return service.snapshot();
  });
  rpc.handle("accounts.add", async (payload) => {
    const parsed = addAccountPayloadSchema.parse(payload ?? {});
    await service.add(parsed);
    return null;
  });
  rpc.handle("accounts.adoptCurrent", async (payload) => {
    emptyRpcPayloadSchema.parse(payload);
    await service.adoptCurrent();
    return null;
  });
  rpc.handle("accounts.completeLogin", async (payload) => {
    await service.completeLogin(completeLoginPayloadSchema.parse(payload));
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
      force: request.force ?? true,
    });
    return null;
  });
  rpc.handle("accounts.refreshAllUsage", async (payload) => {
    emptyRpcPayloadSchema.parse(payload);
    await service.refreshAllUsage({ force: true });
    return null;
  });
  rpc.handle("accounts.usagePolling.acquire", async (payload) => {
    const { consumerId } = usagePollingPayloadSchema.parse(payload);
    await acquireUsagePolling(consumerId);
    return null;
  });
  rpc.handle("accounts.usagePolling.release", async (payload) => {
    const { consumerId } = usagePollingPayloadSchema.parse(payload);
    releaseUsagePolling(consumerId);
    return null;
  });
}
