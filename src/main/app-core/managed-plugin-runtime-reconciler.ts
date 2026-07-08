import type { ExternalMainPluginRuntime } from "../plugins/external-main-runtime.ts";
import type { ManagedPluginRuntimeSource } from "../services/managed-plugins/install-runtime.ts";

export function runtimeSourceActivationKey(
  source: ManagedPluginRuntimeSource
): string {
  return [
    source.id,
    source.kind,
    source.version,
    source.mainEntryPath,
    source.rendererEntryUrl,
    source.sourceRevision ?? "",
  ].join("\0");
}

export interface ManagedPluginRuntimeReconciler {
  reconcile(sources: readonly ManagedPluginRuntimeSource[]): Promise<void>;
}

export function createManagedPluginRuntimeReconciler(
  runtime: ExternalMainPluginRuntime
): ManagedPluginRuntimeReconciler {
  const activeKeys = new Map<string, string>();

  return {
    async reconcile(sources): Promise<void> {
      const enabledSources = sources.filter((source) => source.enabled);
      const nextEnabledIds = new Set(enabledSources.map((source) => source.id));

      for (const activeId of Array.from(activeKeys.keys())) {
        if (nextEnabledIds.has(activeId)) {
          continue;
        }
        await runtime.dispose(activeId);
        activeKeys.delete(activeId);
      }

      for (const source of enabledSources) {
        const nextKey = runtimeSourceActivationKey(source);
        const currentKey = activeKeys.get(source.id);
        if (!currentKey) {
          await runtime.activate(source);
          activeKeys.set(source.id, nextKey);
          continue;
        }
        if (currentKey !== nextKey) {
          await runtime.reload(source);
          activeKeys.set(source.id, nextKey);
        }
      }
    },
  };
}
