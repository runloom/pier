import type { ExternalMainPluginRuntime } from "../../plugins/external-main-runtime.ts";
import type { ManagedPluginRuntimeSource } from "../../services/managed-plugins/install-runtime.ts";

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

export interface CreateManagedPluginRuntimeReconcilerOptions {
  /**
   * @deprecated Use waitForHostEnv. Accepted as alias during migration.
   */
  ensurePath?: () => Promise<void>;
  /**
   * Await host shell-env readiness before activating plugins that spawn CLIs.
   * Must be the same Promise as hostShellEnvReady (no second PATH dump).
   */
  waitForHostEnv?: () => Promise<void>;
}

export function createManagedPluginRuntimeReconciler(
  runtime: ExternalMainPluginRuntime,
  options: CreateManagedPluginRuntimeReconcilerOptions = {}
): ManagedPluginRuntimeReconciler {
  const activeKeys = new Map<string, string>();
  const waitForHostEnv = options.waitForHostEnv ?? options.ensurePath;

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
          if (waitForHostEnv) {
            await waitForHostEnv();
          }
          try {
            await runtime.activate(source);
          } catch (error) {
            // 失败语义契约：单个插件 activate 失败不阻断后续插件。
            // runtime.activate 内部已清理 RPC/disposer 并上报激活结果。
            console.error(
              `[plugin-reconciler] activate failed for ${source.id}:`,
              error instanceof Error ? error.message : String(error)
            );
            continue;
          }
          activeKeys.set(source.id, nextKey);
          continue;
        }
        if (currentKey !== nextKey) {
          if (waitForHostEnv) {
            await waitForHostEnv();
          }
          try {
            await runtime.reload(source);
          } catch (error) {
            // reload 失败同上：保留旧键会与真实状态漂移，这里清除并继续。
            activeKeys.delete(source.id);
            console.error(
              `[plugin-reconciler] reload failed for ${source.id}:`,
              error instanceof Error ? error.message : String(error)
            );
            continue;
          }
          activeKeys.set(source.id, nextKey);
        }
      }
    },
  };
}
