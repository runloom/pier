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
import { yaml, yamlFrontmatter } from "@codemirror/lang-yaml";
import {
  LanguageDescription,
  LanguageSupport,
  StreamLanguage,
} from "@codemirror/language";
import { c as clikeC, java, kotlin } from "@codemirror/legacy-modes/mode/clike";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { standardSQL } from "@codemirror/legacy-modes/mode/sql";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { pierMarkdownMarkExtension } from "./markdown-marks.ts";

function streamSupport(mode: Parameters<typeof StreamLanguage.define>[0]) {
  return new LanguageSupport(StreamLanguage.define(mode));
}

/**
 * Fenced-code languages for nested highlighting inside Markdown.
 * Mirrors the files plugin set (no `@codemirror/language-data`).
 */
export const pierFencedCodeLanguages: readonly LanguageDescription[] = [
  LanguageDescription.of({
    name: "C",
    alias: ["c"],
    extensions: ["c", "h"],
    support: streamSupport(clikeC),
  }),
  LanguageDescription.of({
    name: "C++",
    alias: ["cpp", "c++", "cxx"],
    extensions: ["cpp", "cc", "cxx", "hpp"],
    support: cpp(),
  }),
  LanguageDescription.of({
    name: "CSS",
    alias: ["css"],
    extensions: ["css"],
    support: css(),
  }),
  LanguageDescription.of({
    name: "Go",
    alias: ["go", "golang"],
    extensions: ["go"],
    support: go(),
  }),
  LanguageDescription.of({
    name: "HTML",
    alias: ["html", "htm"],
    extensions: ["html", "htm"],
    support: html(),
  }),
  LanguageDescription.of({
    name: "Java",
    alias: ["java"],
    extensions: ["java"],
    support: streamSupport(java),
  }),
  LanguageDescription.of({
    name: "JavaScript",
    alias: ["js", "javascript", "mjs", "cjs"],
    extensions: ["js", "mjs", "cjs"],
    support: javascript(),
  }),
  LanguageDescription.of({
    name: "JSON",
    alias: ["json"],
    extensions: ["json"],
    support: json(),
  }),
  LanguageDescription.of({
    name: "JSX",
    alias: ["jsx"],
    extensions: ["jsx"],
    support: javascript({ jsx: true }),
  }),
  LanguageDescription.of({
    name: "Kotlin",
    alias: ["kt", "kotlin"],
    extensions: ["kt", "kts"],
    support: streamSupport(kotlin),
  }),
  LanguageDescription.of({
    name: "Python",
    alias: ["py", "python"],
    extensions: ["py"],
    support: python(),
  }),
  LanguageDescription.of({
    name: "Ruby",
    alias: ["rb", "ruby"],
    extensions: ["rb"],
    support: streamSupport(ruby),
  }),
  LanguageDescription.of({
    name: "Rust",
    alias: ["rs", "rust"],
    extensions: ["rs"],
    support: rust(),
  }),
  LanguageDescription.of({
    name: "Shell",
    alias: ["bash", "sh", "zsh", "shell", "shellscript"],
    extensions: ["sh", "bash"],
    support: streamSupport(shell),
  }),
  LanguageDescription.of({
    name: "SQL",
    alias: ["sql"],
    extensions: ["sql"],
    support: streamSupport(standardSQL),
  }),
  LanguageDescription.of({
    name: "Swift",
    alias: ["swift"],
    extensions: ["swift"],
    support: streamSupport(swift),
  }),
  LanguageDescription.of({
    name: "TOML",
    alias: ["toml"],
    extensions: ["toml"],
    support: streamSupport(toml),
  }),
  LanguageDescription.of({
    name: "TSX",
    alias: ["tsx"],
    extensions: ["tsx"],
    support: javascript({ jsx: true, typescript: true }),
  }),
  LanguageDescription.of({
    name: "TypeScript",
    alias: ["ts", "typescript"],
    extensions: ["ts"],
    support: javascript({ typescript: true }),
  }),
  LanguageDescription.of({
    name: "XML",
    alias: ["xml"],
    extensions: ["xml"],
    support: xml(),
  }),
  LanguageDescription.of({
    name: "YAML",
    alias: ["yml", "yaml"],
    extensions: ["yml", "yaml"],
    support: yaml(),
  }),
];

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
