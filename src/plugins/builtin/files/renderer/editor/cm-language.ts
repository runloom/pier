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
  dart as clikeDart,
  scala as clikeScala,
  csharp,
  java,
  kotlin,
} from "@codemirror/legacy-modes/mode/clike";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { r as rMode } from "@codemirror/legacy-modes/mode/r";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { sass as sassMode } from "@codemirror/legacy-modes/mode/sass";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { standardSQL } from "@codemirror/legacy-modes/mode/sql";
import { stylus as stylusMode } from "@codemirror/legacy-modes/mode/stylus";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import type { Extension } from "@codemirror/state";
import { svelte } from "@replit/codemirror-lang-svelte";
import { detectLiveModuleFrameworkFromFileName } from "@shared/live-module-framework.ts";
import { pierAstroLanguage } from "@shared/source-editor/astro-language.ts";
import { pierMarkdownLanguage } from "@shared/source-editor/markdown-language.ts";
import { graphqlMode, hclMode } from "@shared/source-editor/stream-modes.ts";
import type {
  BuiltinFilesDocumentLanguage,
  FilesDocumentLanguage,
} from "../document/types.ts";
import { cmExtensionForHighlightPreset } from "./language/highlight-preset.ts";
import { editorLanguageModeRegistry } from "./language/mode-registry.ts";

function vueLanguageExtension(): Extension {
  // Nested HTML base so <script>/<style> still get JS/CSS tokens.
  return vue({ base: html() });
}

function svelteLanguageExtension(): Extension {
  return svelte();
}

/**
 * Live Modules canvas badge stays "Canvas"; highlight follows framework suffix
 * (`.canvas.vue` ≠ React TSX).
 */
function canvasLanguageExtension(path?: string): Extension {
  const framework = path ? detectLiveModuleFrameworkFromFileName(path) : null;
  if (framework === "vue") {
    return vueLanguageExtension();
  }
  if (framework === "svelte") {
    return svelteLanguageExtension();
  }
  // react / solid (and unknown) → TSX
  return javascript({ typescript: true, jsx: true });
}

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
    case "astro":
      return pierAstroLanguage();
    case "canvas":
      return canvasLanguageExtension(path);
    case "cpp": {
      const lower = path?.toLowerCase() ?? "";
      // C and Objective-C share the clike stream parser; C++/ObjC++ use lang-cpp.
      if (
        lower.endsWith(".c") ||
        lower.endsWith(".h") ||
        lower.endsWith(".m")
      ) {
        return StreamLanguage.define(clikeC);
      }
      return cpp();
    }
    case "csharp":
      return StreamLanguage.define(csharp);
    case "css": {
      const lower = path?.toLowerCase() ?? "";
      // Indented .sass / Stylus are not CSS/SCSS; Less/SCSS share CSS.
      if (lower.endsWith(".sass")) {
        return StreamLanguage.define(sassMode);
      }
      if (lower.endsWith(".styl")) {
        return StreamLanguage.define(stylusMode);
      }
      return css();
    }
    case "dart":
      return StreamLanguage.define(clikeDart);
    case "dockerfile":
      return StreamLanguage.define(dockerFile);
    case "elixir":
      return StreamLanguage.define(ruby);
    case "go":
      return go();
    case "graphql":
      return StreamLanguage.define(graphqlMode);
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
    case "lua":
      return StreamLanguage.define(lua);
    case "markdown":
      return pierMarkdownLanguage();
    case "php":
      return StreamLanguage.define(clikeC);
    case "python":
      return python();
    case "r":
      return StreamLanguage.define(rMode);
    case "ruby":
      return StreamLanguage.define(ruby);
    case "rust":
      return rust();
    case "scala":
      return StreamLanguage.define(clikeScala);
    case "shell":
      return StreamLanguage.define(shell);
    case "sql":
      return StreamLanguage.define(standardSQL);
    case "svelte":
      return svelteLanguageExtension();
    case "svg":
      // SVG source is XML; dedicated SVG grammar not required for v1.
      return xml();
    case "swift":
      return StreamLanguage.define(swift);
    case "terraform":
      return StreamLanguage.define(hclMode);
    case "toml":
      return StreamLanguage.define(toml);
    case "typescript": {
      const isTsx = path?.toLowerCase().endsWith(".tsx") ?? false;
      return javascript({ typescript: true, jsx: isTsx });
    }
    case "vue":
      return vueLanguageExtension();
    case "xml":
      return xml();
    case "yaml":
      return yaml();
    case "zig":
      // No dedicated Zig grammar; C-like is a reasonable approximate.
      return StreamLanguage.define(clikeC);
    default: {
      // Plugin / L1 language modes: closed highlight presets only.
      const preset =
        editorLanguageModeRegistry.highlightForLanguageId(language);
      if (preset) {
        return cmExtensionForHighlightPreset(preset);
      }
      return null;
    }
  }
}

// 顶部语言标签的短名。文件面板右上角展示,与 Cursor 右上 `Swift`/`TypeScript` 徽章对齐。
export const LANGUAGE_LABELS: Readonly<
  Record<BuiltinFilesDocumentLanguage, string>
> = {
  astro: "Astro",
  canvas: "Canvas",
  cpp: "C++",
  csharp: "C#",
  css: "CSS",
  dart: "Dart",
  dockerfile: "Dockerfile",
  elixir: "Elixir",
  go: "Go",
  graphql: "GraphQL",
  html: "HTML",
  java: "Java",
  javascript: "JavaScript",
  json: "JSON",
  kotlin: "Kotlin",
  lua: "Lua",
  markdown: "Markdown",
  php: "PHP",
  python: "Python",
  r: "R",
  ruby: "Ruby",
  rust: "Rust",
  scala: "Scala",
  shell: "Shell",
  sql: "SQL",
  svelte: "Svelte",
  svg: "SVG",
  swift: "Swift",
  terraform: "Terraform",
  text: "Plain Text",
  toml: "TOML",
  typescript: "TypeScript",
  vue: "Vue",
  xml: "XML",
  yaml: "YAML",
  zig: "Zig",
};

/** Badge label for builtin or dynamic (plugin / L1) language ids. */
export function languageLabel(language: FilesDocumentLanguage): string {
  if (Object.hasOwn(LANGUAGE_LABELS, language)) {
    return LANGUAGE_LABELS[language as BuiltinFilesDocumentLanguage];
  }
  return (
    editorLanguageModeRegistry.labelForLanguageId(language) ??
    LANGUAGE_LABELS.text
  );
}
