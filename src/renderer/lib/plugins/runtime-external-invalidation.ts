import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { clearRendererPluginRuntimeDiagnostic } from "./plugin-runtime-diagnostics.ts";
import { runtimeEntrySignature } from "./runtime-entry-signature.ts";

export interface PendingExternalAttempt {
  abortController: AbortController;
  signature: string;
  token: symbol;
}

export function invalidateSupersededExternalAttempts(input: {
  desired: ReadonlyMap<string, PluginRegistryEntry>;
  diagnosticPluginIds: Set<string>;
  hasTransitionGate(pluginId: string): boolean;
  pending: Map<string, PendingExternalAttempt>;
}): void {
  for (const [pluginId, pending] of input.pending) {
    const desired = input.desired.get(pluginId);
    if (
      desired?.runtime.kind !== "external" ||
      runtimeEntrySignature(desired) !== pending.signature ||
      input.hasTransitionGate(pluginId)
    ) {
      pending.abortController.abort();
      input.pending.delete(pluginId);
    }
  }
  for (const pluginId of input.diagnosticPluginIds) {
    if (input.desired.get(pluginId)?.runtime.kind !== "external") {
      input.diagnosticPluginIds.delete(pluginId);
      clearRendererPluginRuntimeDiagnostic(pluginId);
    }
  }
}
