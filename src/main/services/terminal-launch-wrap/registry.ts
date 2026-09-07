import type { LaunchWrapHandler } from "@pier/plugin-api/main";

const handlers = new Map<string, LaunchWrapHandler>();

export function assertLaunchWrapCapability(
  pluginId: string,
  permissions: readonly string[]
): void {
  if (!permissions.includes("terminal:launchWrap")) {
    throw new Error(`plugin ${pluginId} lacks terminal:launchWrap`);
  }
}

export function registerLaunchWrapHandler(
  pluginId: string,
  handler: LaunchWrapHandler
): () => void {
  handlers.set(pluginId, handler);
  return () => {
    if (handlers.get(pluginId) === handler) {
      handlers.delete(pluginId);
    }
  };
}

export function listLaunchWrapHandlers(): Array<{
  handler: LaunchWrapHandler;
  pluginId: string;
}> {
  return [...handlers.entries()]
    .map(([pluginId, handler]) => ({ handler, pluginId }))
    .sort((left, right) => left.pluginId.localeCompare(right.pluginId));
}

export function resetLaunchWrapRegistryForTests(): void {
  handlers.clear();
}
