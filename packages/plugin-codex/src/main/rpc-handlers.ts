import type { MainPluginContext } from "@pier/plugin-api/main";
import { z } from "zod/mini";
import {
  addAccountPayloadSchema,
  emptyRpcPayloadSchema,
  refreshUsagePayloadSchema,
  removeAccountPayloadSchema,
  selectAccountPayloadSchema,
} from "../shared/accounts.ts";
import type { CodexAccountsService } from "./accounts-service-contract.ts";

export function registerCodexRpcHandlers(options: {
  acquireUsagePolling: (consumerId: string) => Promise<void>;
  refreshLocalUsage: () => Promise<void>;
  releaseUsagePolling: (consumerId: string) => void;
  rpc: MainPluginContext["rpc"];
  service: CodexAccountsService;
}): void {
  const {
    acquireUsagePolling,
    refreshLocalUsage,
    releaseUsagePolling,
    rpc,
    service,
  } = options;
  const usagePollingPayloadSchema = z.object({
    consumerId: z.string().check(z.minLength(1), z.maxLength(200)),
  });
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
  rpc.handle("usage.refreshCost", async (payload) => {
    emptyRpcPayloadSchema.parse(payload);
    await refreshLocalUsage();
    return null;
  });
}
