import { html } from "@codemirror/lang-html";
import type { LanguageSupport } from "@codemirror/language";

/** Astro has no L0 grammar; HTML self-closing tags stand in for the template. */
export function pierAstroLanguage(): LanguageSupport {
  return html({ selfClosingTags: true });
}
