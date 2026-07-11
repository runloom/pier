import type { RendererPluginSuspendReason } from "./plugin-lifecycle-types.ts";

export async function disposeRendererPlugins(
  pluginIds: readonly string[],
  reason: RendererPluginSuspendReason,
  dispose: (
    pluginId: string,
    reason: RendererPluginSuspendReason
  ) => Promise<void>
): Promise<void> {
  const failures: unknown[] = [];
  for (const pluginId of pluginIds) {
    try {
      await dispose(pluginId, reason);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, "renderer plugin dispose failed");
  }
}

export async function disposeRendererPluginsAfterDrain(
  pluginIds: readonly string[],
  reason: RendererPluginSuspendReason,
  waitForDrain: (pluginId: string) => Promise<void>,
  dispose: (
    pluginId: string,
    reason: RendererPluginSuspendReason
  ) => Promise<void>
): Promise<void> {
  const results = await Promise.allSettled(
    pluginIds.map(async (pluginId) => {
      await waitForDrain(pluginId);
      await dispose(pluginId, reason);
    })
  );
  const failures = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : []
  );
  if (failures.length > 0) {
    throw new AggregateError(failures, "renderer plugin dispose failed");
  }
}
