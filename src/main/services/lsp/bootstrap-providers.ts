import { createVueLspProvider } from "./providers/config-language-providers.ts";
import { createPathMatrixLspProviders } from "./providers/path-matrix-providers.ts";
import { createTypescriptLspProvider } from "./providers/typescript-provider.ts";
import { LspServerRegistry } from "./server-registry.ts";

/**
 * L0 registry: bundled TypeScript + hybrid Vue + all PATH matrix languages.
 */
export function createBootstrappedLspRegistry(): LspServerRegistry {
  const registry = new LspServerRegistry();
  registry.register(createTypescriptLspProvider());
  registry.register(createVueLspProvider());
  for (const provider of createPathMatrixLspProviders()) {
    registry.register(provider);
  }
  return registry;
}
