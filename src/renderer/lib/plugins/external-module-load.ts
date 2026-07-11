import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import type { loadExternalRendererModule } from "./external-renderer-loader.ts";

export async function loadExternalModuleWithTimeout(input: {
  entry: PluginRegistryEntry;
  loader: typeof loadExternalRendererModule;
  signal: AbortSignal;
  timeoutMs: number;
}) {
  const { entry, loader, signal, timeoutMs } = input;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let onAbort: (() => void) | null = null;
  try {
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        reject(
          new Error(
            `renderer plugin load timed out after ${timeoutMs}ms: ${entry.manifest.id}`
          )
        );
      }, timeoutMs);
    });
    const abortPromise = new Promise<never>((_resolve, reject) => {
      onAbort = () =>
        reject(new Error("renderer plugin activation superseded"));
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    });
    return await Promise.race([
      loader({
        expectedPluginId: entry.manifest.id,
        rendererEntryUrl: entry.runtime.rendererEntryUrl ?? "",
      }),
      timeoutPromise,
      abortPromise,
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
    if (onAbort) {
      signal.removeEventListener("abort", onAbort);
    }
  }
}
