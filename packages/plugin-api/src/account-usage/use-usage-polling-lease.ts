import { useEffect, useRef } from "react";
import type { ExternalRendererPluginContext } from "../renderer.ts";
import { USAGE_POLLING_HEARTBEAT_MS } from "./usage-polling-registry.ts";

/**
 * Acquire/release accounts.usagePolling while a settings page or widget is
 * visible. logLabel is only for diagnostics (e.g. "pier.grok").
 *
 * The consumer id is suffixed with a per-mount random token so identical
 * logical ids from different windows (or duplicate widget instances restored
 * from a shared layout) never collapse into one lease — releasing one window
 * must not stop polling for another. While active, the lease is renewed on a
 * heartbeat so the main process can expire leases from windows that reloaded
 * or crashed without running unmount effects.
 */
export function useUsagePollingLease(
  context: ExternalRendererPluginContext,
  consumerId: string,
  active: boolean,
  logLabel = "plugin"
): void {
  const mountToken = useRef<string | null>(null);
  if (mountToken.current === null) {
    mountToken.current =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
  }
  const uniqueConsumerId = `${consumerId}#${mountToken.current}`;

  useEffect(() => {
    if (!active) return;
    let acquired = false;
    let released = false;
    const payload = { consumerId: uniqueConsumerId };
    const release = (): void => {
      context.rpc
        .invoke("accounts.usagePolling.release", payload)
        .catch((error: unknown) => {
          console.warn(`[${logLabel}] could not release usage polling`, error);
        });
    };
    const acquire = (): void => {
      context.rpc
        .invoke("accounts.usagePolling.acquire", payload)
        .then(() => {
          acquired = true;
          if (released) release();
        })
        .catch((error: unknown) => {
          console.warn(`[${logLabel}] could not acquire usage polling`, error);
        });
    };
    acquire();
    // Renew the lease so the main process keeps it alive past its TTL.
    const heartbeat = setInterval(() => {
      if (!released) acquire();
    }, USAGE_POLLING_HEARTBEAT_MS);
    return () => {
      released = true;
      clearInterval(heartbeat);
      if (acquired) release();
    };
  }, [active, uniqueConsumerId, context, logLabel]);
}
