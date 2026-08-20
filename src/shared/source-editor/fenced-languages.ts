/**
 * Nested / hover highlight catalog. Markdown fences and LSP hover both
 * resolve through this table so they stay locked to the Files editor set.
 */

import { cpp } from "@codemirror/lang-cpp";
import { css } from "@codemirror/lang-css";
import { go } from "@codemirror/lang-go";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { vue } from "@codemirror/lang-vue";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import {
  type Language,
  LanguageDescription,
  LanguageSupport,
  StreamLanguage,
} from "@codemirror/language";
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
import { svelte } from "@replit/codemirror-lang-svelte";
import { pierAstroLanguage } from "./astro-language.ts";
import { graphqlMode, hclMode } from "./stream-modes.ts";

function stream(
  mode: Parameters<typeof StreamLanguage.define>[0]
): LanguageSupport {
  return new LanguageSupport(StreamLanguage.define(mode));
}

interface HighlightLanguageRow {
  readonly alias: readonly string[];
  readonly extensions: readonly string[];
  readonly name: string;
  readonly support: LanguageSupport;
}

function row(
  name: string,
  alias: readonly string[],
  extensions: readonly string[],
  support: LanguageSupport
): HighlightLanguageRow {
  return { alias, extensions, name, support };
}

const jsx = javascript({ jsx: true });
const ts = javascript({ typescript: true });
const tsx = javascript({ jsx: true, typescript: true });
const xmlSupport = xml();

const ROWS: readonly HighlightLanguageRow[] = [
  row("Astro", ["astro"], ["astro"], pierAstroLanguage()),
  row("C", ["c", "objective-c"], ["c", "h", "m"], stream(clikeC)),
  row(
    "C++",
    ["cpp", "c++", "cxx", "objective-cpp"],
    ["cpp", "cc", "cxx", "hpp", "hxx", "hh", "mm"],
    cpp()
  ),
  row("C#", ["csharp", "cs", "c#"], ["cs"], stream(csharp)),
  row("CSS", ["css", "scss", "less"], ["css", "scss", "less"], css()),
  row("Dart", ["dart"], ["dart"], stream(clikeDart)),
  row(
    "Dockerfile",
    ["dockerfile", "docker"],
    ["dockerfile"],
    stream(dockerFile)
  ),
  row("Elixir", ["elixir", "ex", "exs"], ["ex", "exs"], stream(ruby)),
  row("Go", ["go", "golang"], ["go"], go()),
  row("GraphQL", ["graphql", "gql"], ["graphql", "gql"], stream(graphqlMode)),
  row("HTML", ["html", "htm"], ["html", "htm"], html()),
  row("Java", ["java"], ["java"], stream(java)),
  row(
    "JavaScript",
    ["js", "javascript", "mjs", "cjs"],
    ["js", "mjs", "cjs"],
    javascript()
  ),
  row("JSON", ["json", "jsonc", "json5"], ["json", "jsonc", "json5"], json()),
  row("JSX", ["jsx", "javascriptreact"], ["jsx"], jsx),
  row("Kotlin", ["kt", "kotlin", "kts"], ["kt", "kts"], stream(kotlin)),
  row("Lua", ["lua"], ["lua"], stream(lua)),
  row(
    "Markdown",
    ["markdown", "md", "mdx"],
    ["md", "mdx", "markdown"],
    markdown()
  ),
  row("PHP", ["php"], ["php"], stream(clikeC)),
  row("Python", ["py", "python", "pyi"], ["py", "pyi"], python()),
  row("R", ["r", "rmd"], ["r", "rmd"], stream(rMode)),
  row("Ruby", ["rb", "ruby"], ["rb"], stream(ruby)),
  row("Rust", ["rs", "rust"], ["rs"], rust()),
  row("Sass", ["sass"], ["sass"], stream(sassMode)),
  row("Scala", ["scala", "sc"], ["scala", "sc"], stream(clikeScala)),
  row(
    "Shell",
    ["bash", "sh", "zsh", "shell", "shellscript", "fish"],
    ["sh", "bash", "zsh", "fish"],
    stream(shell)
  ),
  row("SQL", ["sql"], ["sql"], stream(standardSQL)),
  row("Stylus", ["stylus", "styl"], ["styl"], stream(stylusMode)),
  row("Svelte", ["svelte"], ["svelte"], svelte()),
  row("SVG", ["svg"], ["svg"], xmlSupport),
  row("Swift", ["swift"], ["swift"], stream(swift)),
  row(
    "Terraform",
    ["terraform", "tf", "tfvars", "hcl"],
    ["tf", "tfvars", "hcl"],
    stream(hclMode)
  ),
  row("TOML", ["toml"], ["toml"], stream(toml)),
  row("TSX", ["tsx", "typescriptreact"], ["tsx"], tsx),
  row(
    "TypeScript",
    ["ts", "typescript", "mts", "cts"],
    ["ts", "mts", "cts"],
    ts
  ),
  row("Vue", ["vue"], ["vue"], vue({ base: html() })),
  row("XML", ["xml"], ["xml"], xmlSupport),
  row("YAML", ["yml", "yaml"], ["yml", "yaml"], yaml()),
  row("Zig", ["zig", "zon"], ["zig", "zon"], stream(clikeC)),
];

export const pierFencedCodeLanguages: readonly LanguageDescription[] = ROWS.map(
  (item) =>
    LanguageDescription.of({
      alias: [...item.alias],
      extensions: [...item.extensions],
      name: item.name,
      support: item.support,
    })
);

const LANGUAGE_BY_TAG: ReadonlyMap<string, Language> = (() => {
  const map = new Map<string, Language>();
  for (const item of ROWS) {
    const language = item.support.language;
    for (const tag of [item.name, ...item.alias, ...item.extensions]) {
      const key = tag.toLowerCase();
      if (!map.has(key)) {
        map.set(key, language);
      }
    }
  }
  return map;
})();

/** Resolve a fence / LSP language tag to a CodeMirror Language. */
export function pierHighlightLanguage(name: string): Language | null {
  const key = name.trim().toLowerCase();
  if (key.length === 0) {
    return null;
  }
  return LANGUAGE_BY_TAG.get(key) ?? null;
}
