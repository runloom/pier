/**
 * Map closed EditorHighlightPreset ids to CodeMirror language extensions.
 */

import { cpp } from "@codemirror/lang-cpp";
import { css } from "@codemirror/lang-css";
import { go } from "@codemirror/lang-go";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { vue } from "@codemirror/lang-vue";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import { StreamLanguage } from "@codemirror/language";
import {
  c as clikeC,
  csharp,
  java,
  kotlin,
} from "@codemirror/legacy-modes/mode/clike";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { standardSQL } from "@codemirror/legacy-modes/mode/sql";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import type { Extension } from "@codemirror/state";
import { svelte } from "@replit/codemirror-lang-svelte";
import type { EditorHighlightPreset } from "@shared/contracts/plugin-language-mode.ts";
import { pierMarkdownLanguage } from "@shared/source-editor/markdown-language.ts";

export function cmExtensionForHighlightPreset(
  preset: EditorHighlightPreset
): Extension | null {
  switch (preset) {
    case "text":
      return null;
    case "javascript":
      return javascript();
    case "typescript":
      return javascript({ typescript: true });
    case "jsx":
      return javascript({ jsx: true, typescript: true });
    case "html":
      return html();
    case "xml":
      return xml();
    case "css":
      return css();
    case "json":
      return json();
    case "yaml":
      return yaml();
    case "markdown":
      return pierMarkdownLanguage();
    case "python":
      return python();
    case "go":
      return go();
    case "rust":
      return rust();
    case "clike":
      return StreamLanguage.define(clikeC);
    case "cpp":
      return cpp();
    case "java":
      return StreamLanguage.define(java);
    case "csharp":
      return StreamLanguage.define(csharp);
    case "kotlin":
      return StreamLanguage.define(kotlin);
    case "shell":
      return StreamLanguage.define(shell);
    case "sql":
      return StreamLanguage.define(standardSQL);
    case "toml":
      return StreamLanguage.define(toml);
    case "ruby":
      return StreamLanguage.define(ruby);
    case "swift":
      return StreamLanguage.define(swift);
    case "vue":
      return vue({ base: html() });
    case "svelte":
      return svelte();
    default: {
      const _exhaustive: never = preset;
      return _exhaustive;
    }
  }
}
