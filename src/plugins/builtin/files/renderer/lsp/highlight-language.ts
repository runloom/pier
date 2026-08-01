/**
 * Resolve LSP / markdown fence language tags to CodeMirror Language objects
 * so hover signatures and code fences share the editor's highlight pipeline.
 */

import { cpp } from "@codemirror/lang-cpp";
import { css } from "@codemirror/lang-css";
import { go } from "@codemirror/lang-go";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import { type Language, StreamLanguage } from "@codemirror/language";
import { c as clikeC, java, kotlin } from "@codemirror/legacy-modes/mode/clike";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { standardSQL } from "@codemirror/legacy-modes/mode/sql";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { toml } from "@codemirror/legacy-modes/mode/toml";

function languageSupportLanguage(
  support: { language: Language } | Language
): Language {
  return "language" in support ? support.language : support;
}

/**
 * Map a language id from LSP MarkedString / markdown fences to a Language.
 * Unknown tags return null (plain text).
 */
export function filesLspHighlightLanguage(name: string): Language | null {
  const key = name.trim().toLowerCase();
  if (key.length === 0) {
    return null;
  }

  switch (key) {
    case "ts":
    case "tsx":
    case "typescript":
    case "typescriptreact":
      return languageSupportLanguage(
        javascript({
          jsx: key === "tsx" || key === "typescriptreact",
          typescript: true,
        })
      );
    case "js":
    case "jsx":
    case "javascript":
    case "javascriptreact":
    case "mjs":
    case "cjs":
      return languageSupportLanguage(
        javascript({
          jsx: key === "jsx" || key === "javascriptreact",
        })
      );
    case "json":
    case "jsonc":
      return languageSupportLanguage(json());
    case "py":
    case "python":
      return languageSupportLanguage(python());
    case "rs":
    case "rust":
      return languageSupportLanguage(rust());
    case "go":
    case "golang":
      return languageSupportLanguage(go());
    case "css":
    case "scss":
    case "less":
      return languageSupportLanguage(css());
    case "html":
    case "htm":
      return languageSupportLanguage(html());
    case "xml":
    case "svg":
      return languageSupportLanguage(xml());
    case "yml":
    case "yaml":
      return languageSupportLanguage(yaml());
    case "c":
    case "h":
      return StreamLanguage.define(clikeC);
    case "cc":
    case "cpp":
    case "cxx":
    case "c++":
    case "hpp":
      return languageSupportLanguage(cpp());
    case "java":
      return StreamLanguage.define(java);
    case "kt":
    case "kotlin":
      return StreamLanguage.define(kotlin);
    case "rb":
    case "ruby":
      return StreamLanguage.define(ruby);
    case "sh":
    case "bash":
    case "shell":
    case "zsh":
      return StreamLanguage.define(shell);
    case "sql":
      return StreamLanguage.define(standardSQL);
    case "swift":
      return StreamLanguage.define(swift);
    case "toml":
      return StreamLanguage.define(toml);
    default:
      return null;
  }
}
