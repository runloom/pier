/**
 * Register all PATH L0 language servers from the shared language matrix.
 */

import type { LspServerProvider } from "@shared/contracts/lsp-provider.ts";
import {
  asLspProviderDescriptor,
  pathLspDescriptorsFromMatrix,
} from "@shared/language-matrix/index.ts";
import { createPathLspProvider } from "./create-path-provider.ts";

export function createPathMatrixLspProviders(): LspServerProvider[] {
  return pathLspDescriptorsFromMatrix().map((entry) =>
    createPathLspProvider(asLspProviderDescriptor(entry))
  );
}
