/**
 * Stable tok-* HTML highlighting for hover signatures / fenced code.
 * Prefer this over relying on CodeMirror StyleModule class names (ͼ*),
 * which sanitizers and non-editor surfaces handle poorly.
 */

import type { Language } from "@codemirror/language";
import { classHighlighter, highlightCode } from "@lezer/highlight";
import { filesLspHighlightLanguage } from "./highlight-language.ts";

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * Highlight source to HTML spans with `tok-*` classes (classHighlighter).
 * Falls back to escaped plain text when the language is unknown.
 */
export function highlightFilesLspCodeToHtml(
  code: string,
  languageId: string,
  language: Language | null = filesLspHighlightLanguage(languageId)
): string {
  if (!language) {
    return `<pre class="cm-lsp-code"><code>${escapeHtml(code)}</code></pre>`;
  }

  let result = "";
  highlightCode(
    code,
    language.parser.parse(code),
    classHighlighter,
    (text, className) => {
      result += className
        ? `<span class="${className}">${escapeHtml(text)}</span>`
        : escapeHtml(text);
    },
    () => {
      result += "\n";
    }
  );

  return `<pre class="cm-lsp-code"><code>${result}</code></pre>`;
}
