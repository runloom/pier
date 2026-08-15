import { domainToManagedPluginCatalog } from "@shared/contracts/host-catalog/managed-plugin.ts";
import type { ManagedPluginCatalogSnapshot } from "@shared/contracts/plugin/managed.ts";
import { useCallback, useEffect, useState } from "react";
import type { ManagedPluginsWindowShim } from "@/pages/settings/components/managed-plugin-rows.tsx";
import { useHostCatalogStore } from "./store.ts";

function errorDescription(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function useManagedPluginCatalog(): {
  catalog: ManagedPluginCatalogSnapshot | null;
  checkUpdates: () => Promise<ManagedPluginCatalogSnapshot | null>;
  checkingUpdates: boolean;
  error: string | null;
  refresh: () => void;
  win: ManagedPluginsWindowShim | undefined;
} {
  const domain = useHostCatalogStore(
    (state) => state.domains["managed-plugin"]
  );
  const fromHost = domain ? domainToManagedPluginCatalog(domain) : null;
  const [error, setError] = useState<string | null>(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const win = window.pier as ManagedPluginsWindowShim | undefined;

  const applyFresh = useCallback(
    async (force: boolean, classKind: "local" | "remote") => {
      const snapshot = await useHostCatalogStore.getState().ensureFresh({
        class: classKind,
        domain: "managed-plugin",
        ...(force ? { force: true } : {}),
      });
      return domainToManagedPluginCatalog(snapshot);
    },
    []
  );

  useEffect(() => {
    applyFresh(false, "local").catch((err: unknown) => {
      console.error("[managed-plugins] list failed:", err);
      setError(errorDescription(err));
    });
  }, [applyFresh]);

  const refresh = useCallback((): void => {
    applyFresh(true, "local").catch((err: unknown) => {
      console.error("[managed-plugins] refresh failed:", err);
      setError(errorDescription(err));
    });
  }, [applyFresh]);

  const checkUpdates =
    useCallback(async (): Promise<ManagedPluginCatalogSnapshot | null> => {
      setCheckingUpdates(true);
      try {
        return await applyFresh(true, "remote");
      } catch (err: unknown) {
        console.error("[managed-plugins] check updates failed:", err);
        throw err;
      } finally {
        setCheckingUpdates(false);
      }
    }, [applyFresh]);

  return {
    catalog: fromHost,
    checkUpdates,
    checkingUpdates,
    error,
    refresh,
    win,
  };
}
