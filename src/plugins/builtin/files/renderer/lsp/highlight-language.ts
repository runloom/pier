/**
 * Resolve LSP / markdown fence language tags to CodeMirror Language objects
 * so hover signatures and code fences share the editor's highlight pipeline.
 */

import type { Language } from "@codemirror/language";
import { pierHighlightLanguage } from "@shared/source-editor/fenced-languages.ts";

/**
 * Map a language id from LSP MarkedString / markdown fences to a Language.
 * Unknown tags return null (plain text).
 */
export function filesLspHighlightLanguage(name: string): Language | null {
  return pierHighlightLanguage(name);
}
