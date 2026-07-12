import type { ExternalRendererPluginContext } from "@pier/plugin-api/renderer";
import { useEffect } from "react";

export function useUsagePollingLease(
  context: ExternalRendererPluginContext,
  consumerId: string,
  active: boolean
): void {
  useEffect(() => {
    if (!active) return;
    let acquired = false;
    let released = false;
    const payload = { consumerId };
    const release = (): void => {
      context.rpc
        .invoke("accounts.usagePolling.release", payload)
        .catch((error: unknown) => {
          // 生命周期同步不是用户动作；显式刷新仍由对应界面报告失败。
          console.warn("[pier.codex] could not release usage polling", error);
        });
    };
    context.rpc
      .invoke("accounts.usagePolling.acquire", payload)
      .then(() => {
        acquired = true;
        if (released) release();
      })
      .catch((error: unknown) => {
        // 租约失败只停用后台轮询，不影响用户手动刷新。
        console.warn("[pier.codex] could not acquire usage polling", error);
      });
    return () => {
      released = true;
      if (acquired) release();
    };
  }, [active, consumerId, context]);
}
