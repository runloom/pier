import type { LspServerProvider } from "@shared/contracts/lsp-provider.ts";

/**
 * In-process registry of language-server providers.
 * matchForPath returns the highest-priority match (single winner).
 */
export class LspServerRegistry {
  readonly #providers: LspServerProvider[] = [];

  register(provider: LspServerProvider): () => void {
    if (this.#providers.some((entry) => entry.id === provider.id)) {
      throw new Error(`LSP provider already registered: ${provider.id}`);
    }
    this.#providers.push(provider);
    return () => {
      const index = this.#providers.indexOf(provider);
      if (index >= 0) {
        this.#providers.splice(index, 1);
      }
    };
  }

  list(): readonly LspServerProvider[] {
    return this.#providers;
  }

  matchAllForPath(path: string): LspServerProvider[] {
    return this.#providers
      .filter((provider) => provider.matchPath(path))
      .sort((a, b) => b.priority - a.priority);
  }

  matchForPath(path: string): LspServerProvider | null {
    return this.matchAllForPath(path)[0] ?? null;
  }

  getById(id: string): LspServerProvider | null {
    return this.#providers.find((provider) => provider.id === id) ?? null;
  }
}

export function createBuiltinLspServerRegistry(): LspServerRegistry {
  const registry = new LspServerRegistry();
  // Lazy import avoided — bootstrap registers typescript explicitly at call site.
  return registry;
}
