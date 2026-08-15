import type { LspSessionEnsureRequest } from "@shared/contracts/lsp.ts";
import type { LspServerProvider } from "@shared/contracts/lsp-provider.ts";
import type { LspServerRegistry } from "./server-registry.ts";

export function resolveEnsureProvider(
  registry: LspServerRegistry,
  request: Pick<LspSessionEnsureRequest, "filePath" | "languageId">
): LspServerProvider | null {
  if (request.languageId) {
    return registry.matchForLanguageId(request.languageId);
  }
  if (request.filePath) {
    return registry.matchForPath(request.filePath);
  }
  return registry.getById("typescript");
}

export function languageIdForEnsure(
  provider: LspServerProvider,
  request: Pick<LspSessionEnsureRequest, "filePath" | "languageId">
): string {
  return (
    request.languageId ??
    (request.filePath ? provider.languageIdForPath(request.filePath) : null) ??
    provider.selector.languageIds[0] ??
    "plaintext"
  );
}
