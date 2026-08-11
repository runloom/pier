/**
 * Install / display guides for language servers.
 * Populated from core catalog + language plugin manifests — not hardcoded here.
 */

export interface LspInstallGuide {
  displayName: string;
  /** Shell one-liner; omit when bundled / no install path. */
  installCommand?: string;
  /** Provider / contribution id keys (core id or pluginId:contributionId). */
  serverIds: readonly string[];
}

class LspInstallGuideRegistryImpl {
  #byServerId = new Map<string, LspInstallGuide>();

  replaceAll(guides: readonly LspInstallGuide[]): void {
    const next = new Map<string, LspInstallGuide>();
    for (const guide of guides) {
      for (const id of guide.serverIds) {
        if (id.length > 0) {
          next.set(id, guide);
        }
      }
    }
    this.#byServerId = next;
  }

  get(serverId: string | undefined): LspInstallGuide | undefined {
    if (!serverId) {
      return;
    }
    const exact = this.#byServerId.get(serverId);
    if (exact) {
      return exact;
    }
    // Plugin providers use `{pluginId}:{contributionId}`; also try leaf id.
    if (serverId.includes(":")) {
      const leaf = serverId.split(":").at(-1);
      if (leaf) {
        return this.#byServerId.get(leaf);
      }
    }
    return;
  }
}

export const lspInstallGuideRegistry = new LspInstallGuideRegistryImpl();
