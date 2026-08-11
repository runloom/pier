import { createConfigLanguageLspProviders } from "./providers/config-language-providers.ts";
import { createGoplsLspProvider } from "./providers/gopls-provider.ts";
import { createPyrightLspProvider } from "./providers/pyright-provider.ts";
import { createRustAnalyzerLspProvider } from "./providers/rust-analyzer-provider.ts";
import { createTypescriptLspProvider } from "./providers/typescript-provider.ts";
import { LspServerRegistry } from "./server-registry.ts";

export function createBootstrappedLspRegistry(): LspServerRegistry {
  const registry = new LspServerRegistry();
  registry.register(createTypescriptLspProvider());
  registry.register(createPyrightLspProvider());
  registry.register(createGoplsLspProvider());
  registry.register(createRustAnalyzerLspProvider());
  for (const provider of createConfigLanguageLspProviders()) {
    registry.register(provider);
  }
  return registry;
}
