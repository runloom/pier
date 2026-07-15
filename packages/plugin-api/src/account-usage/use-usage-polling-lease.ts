import { useEffect } from "react";
import type { ExternalRendererPluginContext } from "../renderer.ts";

/**
 * Acquire/release accounts.usagePolling while a settings page or widget is
 * visible. logLabel is only for diagnostics (e.g. "pier.grok").
 */
export function useUsagePollingLease(
  context: ExternalRendererPluginContext,
  consumerId: string,
  active: boolean,
  logLabel = "plugin"
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
          console.warn(`[${logLabel}] could not release usage polling`, error);
        });
    };
    context.rpc
      .invoke("accounts.usagePolling.acquire", payload)
      .then(() => {
        acquired = true;
        if (released) release();
      })
      .catch((error: unknown) => {
        console.warn(`[${logLabel}] could not acquire usage polling`, error);
      });
    return () => {
      released = true;
      if (acquired) release();
    };
  }, [active, consumerId, context, logLabel]);
}
