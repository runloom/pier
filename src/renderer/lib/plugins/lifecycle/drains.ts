export class PluginLifecycleDrainTracker {
  private readonly drainsByPlugin = new Map<string, Set<Promise<unknown>>>();

  has(pluginId: string): boolean {
    return (this.drainsByPlugin.get(pluginId)?.size ?? 0) > 0;
  }

  track(pluginIds: ReadonlySet<string>, drain: Promise<unknown>): void {
    for (const pluginId of pluginIds) {
      const drains = this.drainsByPlugin.get(pluginId) ?? new Set();
      drains.add(drain);
      this.drainsByPlugin.set(pluginId, drains);
    }
    const release = () => {
      for (const pluginId of pluginIds) {
        const drains = this.drainsByPlugin.get(pluginId);
        drains?.delete(drain);
        if (drains?.size === 0) this.drainsByPlugin.delete(pluginId);
      }
    };
    drain.then(release, release);
  }

  async wait(pluginId: string): Promise<void> {
    while (this.has(pluginId)) {
      const drains = [...(this.drainsByPlugin.get(pluginId) ?? [])];
      await Promise.allSettled(drains);
    }
  }
}
