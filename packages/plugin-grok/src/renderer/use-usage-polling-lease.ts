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
          console.warn("[pier.grok] could not release usage polling", error);
        });
    };
    context.rpc
      .invoke("accounts.usagePolling.acquire", payload)
      .then(() => {
        acquired = true;
        if (released) release();
      })
      .catch((error: unknown) => {
        console.warn("[pier.grok] could not acquire usage polling", error);
      });
    return () => {
      released = true;
      if (acquired) release();
    };
  }, [active, consumerId, context]);
}
