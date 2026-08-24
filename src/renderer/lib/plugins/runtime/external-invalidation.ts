import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { clearRendererPluginRuntimeDiagnostic } from "../runtime-diagnostics.ts";
import { runtimeEntrySignature } from "./entry-signature.ts";

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

/**
 * 判定一次外部激活尝试是否仍是当前代次（未被 dispose / 新 refresh /
 * 更新代次取代）。从 RendererPluginRuntime 抽出以便复用与单测。
 */
export function isCurrentExternalAttemptState(input: {
  desired: ReadonlyMap<string, PluginRegistryEntry>;
  disposed: boolean;
  pending: ReadonlyMap<string, PendingExternalAttempt>;
  pluginId: string;
  signature: string;
  token: symbol;
}): boolean {
  const pending = input.pending.get(input.pluginId);
  const desired = input.desired.get(input.pluginId);
  return (
    !input.disposed &&
    pending?.token === input.token &&
    pending.signature === input.signature &&
    desired?.runtime.kind === "external" &&
    runtimeEntrySignature(desired) === input.signature
  );
}
