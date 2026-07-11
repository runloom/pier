import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { runtimeEntrySignature } from "./runtime-entry-signature.ts";
import type { PendingExternalAttempt } from "./runtime-external-invalidation.ts";

export function queueExternalActivation(options: {
  activate: (signature: string, token: symbol) => Promise<void>;
  entry: PluginRegistryEntry;
  pending: Map<string, PendingExternalAttempt>;
}): void {
  const pluginId = options.entry.manifest.id;
  const signature = runtimeEntrySignature(options.entry);
  const token = Symbol(pluginId);
  options.pending.set(pluginId, {
    abortController: new AbortController(),
    signature,
    token,
  });
  options.activate(signature, token).catch((error) => {
    console.error(
      `[renderer-plugin-runtime] external ${pluginId} attempt failed:`,
      error
    );
  });
}
