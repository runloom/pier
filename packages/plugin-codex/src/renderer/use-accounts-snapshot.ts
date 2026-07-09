import type { ExternalRendererPluginContext } from "@pier/plugin-api/renderer";
import { useEffect, useState } from "react";
import type { CodexAccountsSnapshot } from "../shared/accounts.ts";

/**
 * Shared hook for subscribing to Codex accounts snapshot via plugin RPC.
 * Used by both the settings page and the usage widget.
 */
export function useCodexAccountsSnapshot(
  context: ExternalRendererPluginContext
): {
  error: string | null;
  snapshot: CodexAccountsSnapshot | null;
} {
  const [snapshot, setSnapshot] = useState<CodexAccountsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let currentRevision = 0;
    setError(null);

    const unsubscribe = context.rpc.on<CodexAccountsSnapshot>(
      "accounts.changed",
      (event) => {
        if (!disposed && event.revision > currentRevision) {
          currentRevision = event.revision;
          setError(null);
          setSnapshot(event);
        }
      }
    );

    context.rpc
      .invoke<CodexAccountsSnapshot>("accounts.snapshot", null)
      .then((initial) => {
        if (!disposed && initial.revision > currentRevision) {
          currentRevision = initial.revision;
          setError(null);
          setSnapshot(initial);
        }
      })
      .catch((err: unknown) => {
        if (!disposed) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [context]);

  return { error, snapshot };
}
