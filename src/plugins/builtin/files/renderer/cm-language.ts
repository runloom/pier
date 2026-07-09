import { cpp } from "@codemirror/lang-cpp";
import { css } from "@codemirror/lang-css";
import { go } from "@codemirror/lang-go";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import { StreamLanguage } from "@codemirror/language";
import { c as clikeC, java, kotlin } from "@codemirror/legacy-modes/mode/clike";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { standardSQL } from "@codemirror/legacy-modes/mode/sql";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import type { Extension } from "@codemirror/state";
import type { FilesDocumentLanguage } from "./files-document-types.ts";

// Cursor 参考:每个 language id 对应 CodeMirror 里一段“语言 extension”。
// tsx/jsx 通过 lang-javascript 的 `jsx: true`/`typescript: true` flag 表达,
// 不引入独立 tsx 包;kotlin/java/swift 等 legacy stream parser 用
// `StreamLanguage.define` 包成 language extension。返回 null 时走 basicSetup
// 的默认高亮,不阻断编辑。
export function cmLanguageExtension(
  language: FilesDocumentLanguage,
  path?: string
): Extension | null {
  switch (language) {
    case "cpp": {
      const lower = path?.toLowerCase() ?? "";
      if (lower.endsWith(".c") || lower.endsWith(".h")) {
        return StreamLanguage.define(clikeC);
      }
      return cpp();
    }
    case "css":
      return css();
    case "go":
      return go();
    case "html":
      return html();
    case "java":
      return StreamLanguage.define(java);
    case "javascript": {
      const isJsx = path?.toLowerCase().endsWith(".jsx") ?? false;
      return javascript({ jsx: isJsx });
    }
    case "json":
      return json();
    case "kotlin":
      return StreamLanguage.define(kotlin);
    case "markdown":
      return markdown();
    case "python":
      return python();
    case "ruby":
      return StreamLanguage.define(ruby);
    case "rust":
      return rust();
    case "shell":
      return StreamLanguage.define(shell);
    case "sql":
      return StreamLanguage.define(standardSQL);
    case "swift":
      return StreamLanguage.define(swift);
    case "toml":
      return StreamLanguage.define(toml);
    case "typescript": {
      const isTsx = path?.toLowerCase().endsWith(".tsx") ?? false;
      return javascript({ typescript: true, jsx: isTsx });
    }
    case "xml":
      return xml();
    case "yaml":
      return yaml();
    default:
      return null;
  }
}

// 顶部语言标签的短名。文件面板右上角展示,与 Cursor 右上 `Swift`/`TypeScript` 徽章对齐。
export const LANGUAGE_LABELS: Readonly<Record<FilesDocumentLanguage, string>> =
  {
    cpp: "C++",
    css: "CSS",
    go: "Go",
    html: "HTML",
    java: "Java",
    javascript: "JavaScript",
    json: "JSON",
    kotlin: "Kotlin",
    markdown: "Markdown",
    python: "Python",
    ruby: "Ruby",
    rust: "Rust",
    shell: "Shell",
    sql: "SQL",
    swift: "Swift",
    text: "Plain Text",
    toml: "TOML",
    typescript: "TypeScript",
    xml: "XML",
    yaml: "YAML",
  };
