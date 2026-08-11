import type { LspCatalogEntry } from "@shared/contracts/lsp-provider.ts";
import {
  pathCatalogFromMatrix,
  SPECIAL_LSP_CATALOG_ENTRIES,
} from "@shared/language-matrix/index.ts";

/**
 * Static L0 catalog for settings UI. Availability is probed separately.
 * PATH rows come from the language matrix; TypeScript / Vue are special factories.
 */
export const CORE_LSP_CATALOG: readonly LspCatalogEntry[] = [
  ...SPECIAL_LSP_CATALOG_ENTRIES,
  ...pathCatalogFromMatrix(),
];
