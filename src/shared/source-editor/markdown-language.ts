import { markdown } from "@codemirror/lang-markdown";
import { yamlFrontmatter } from "@codemirror/lang-yaml";
import type { LanguageSupport } from "@codemirror/language";
import { pierFencedCodeLanguages } from "./fenced-languages.ts";
import { pierMarkdownMarkExtension } from "./markdown-marks.ts";

export {
  pierFencedCodeLanguages,
  pierHighlightLanguage,
} from "./fenced-languages.ts";

/**
 * SKILL.md / Rules / files `.md`: YAML frontmatter + GFM + nested fences +
 * distinct markup-character tags (list/heading marks, etc.).
 */
export function pierMarkdownLanguage(): LanguageSupport {
  return yamlFrontmatter({
    content: markdown({
      codeLanguages: pierFencedCodeLanguages,
      extensions: [pierMarkdownMarkExtension],
    }),
  });
}
