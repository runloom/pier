export class PluginRuntimeDrainRetryCoordinator {
  private readonly pending = new Map<string, Promise<void>>();

  clear(): void {
    this.pending.clear();
  }

  schedule(
    pluginId: string,
    wait: () => Promise<void>,
    retry: () => void
  ): void {
    if (this.pending.has(pluginId)) return;
    const operation = wait().then(
      () => undefined,
      () => undefined
    );
    this.pending.set(pluginId, operation);
    operation.then(() => {
      if (this.pending.get(pluginId) === operation) {
        this.pending.delete(pluginId);
        retry();
      }
    });
  }
}
