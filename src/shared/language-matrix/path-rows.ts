/**
 * PATH-discovered L0 languages (no bundled server binaries).
 */

import { CORE_PATH_LANGUAGE_MATRIX } from "./path-rows-core.ts";
import { EXTENDED_PATH_LANGUAGE_MATRIX } from "./path-rows-extended.ts";
import type { LanguageMatrixRow } from "./types.ts";

/** All PATH matrix rows. Order does not affect priority (LSP uses `lsp.priority`). */
export const PATH_LANGUAGE_MATRIX: readonly LanguageMatrixRow[] = [
  ...CORE_PATH_LANGUAGE_MATRIX,
  ...EXTENDED_PATH_LANGUAGE_MATRIX,
];
