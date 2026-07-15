import type { MainPluginContext } from "@pier/plugin-api/main";
import { z } from "zod/mini";
import {
  addAccountPayloadSchema,
  emptyRpcPayloadSchema,
  refreshUsagePayloadSchema,
  removeAccountPayloadSchema,
  selectAccountPayloadSchema,
  syncToPeersPayloadSchema,
} from "../shared/accounts.ts";
import type { CodexAccountsService } from "./accounts-service-contract.ts";

export function registerCodexRpcHandlers(options: {
  acquireUsagePolling: (consumerId: string) => Promise<void>;
  releaseUsagePolling: (consumerId: string) => void;
  rpc: MainPluginContext["rpc"];
  service: CodexAccountsService;
}): void {
  const { acquireUsagePolling, releaseUsagePolling, rpc, service } = options;
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
  rpc.handle("accounts.adoptCurrent", async (payload) => {
    emptyRpcPayloadSchema.parse(payload);
    await service.adoptCurrent();
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
  rpc.handle("accounts.syncToPeers", async (payload) => {
    await service.syncToPeers(syncToPeersPayloadSchema.parse(payload));
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
  // v1.2 起 `usage.refreshCost` 由宿主 `window.pier.usageData.refreshAll()`
  // 通过 UsageSourceRegistry fan-out 到 registerSource 上报的 rescan 回调统一
  // 触发，Codex 不再对 renderer 暴露独立 RPC。
}
