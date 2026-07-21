import type { ExternalRendererPluginContext } from "@pier/plugin-api/renderer";
import { useEffect, useState } from "react";
import { HOSTS_CHANGED_EVENT, type SshHostsSnapshot } from "../shared/hosts.ts";

export function useSshHostsSnapshot(context: ExternalRendererPluginContext): {
  error: string | null;
  snapshot: SshHostsSnapshot | null;
} {
  const [snapshot, setSnapshot] = useState<SshHostsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const unsubscribe = context.rpc.on<SshHostsSnapshot>(
      HOSTS_CHANGED_EVENT,
      (payload) => {
        setSnapshot(payload);
      }
    );
    context.rpc
      .invoke<SshHostsSnapshot>("hosts.snapshot")
      .then((result) => {
        if (!cancelled) {
          setSnapshot(result);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [context]);

  return { error, snapshot };
}
