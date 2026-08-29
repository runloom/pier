import type { FileTreeIcons, RemappedIcon } from "@pierre/trees";
import {
  PIER_CANVAS_FILE_ICON_SYMBOL_ID,
  PIER_CANVAS_FILE_ICON_TOKEN,
  PIER_CSHARP_FILE_ICON_SYMBOL_ID,
  PIER_CUSTOM_FILE_ICON_SYMBOLS,
  PIER_CUSTOM_FILE_ICON_TOKENS,
  PIER_DART_FILE_ICON_SYMBOL_ID,
  PIER_ELIXIR_FILE_ICON_SYMBOL_ID,
  PIER_JAVA_FILE_ICON_SYMBOL_ID,
  PIER_KOTLIN_FILE_ICON_SYMBOL_ID,
  PIER_LUA_FILE_ICON_SYMBOL_ID,
  PIER_PHP_FILE_ICON_SYMBOL_ID,
  PIER_R_FILE_ICON_SYMBOL_ID,
  PIER_SCALA_FILE_ICON_SYMBOL_ID,
  PIER_TOML_FILE_ICON_SYMBOL_ID,
  PIER_XML_FILE_ICON_SYMBOL_ID,
} from "./icon-glyphs.ts";

export {
  PIER_CANVAS_FILE_ICON_SYMBOL,
  PIER_CANVAS_FILE_ICON_SYMBOL_ID,
  PIER_CANVAS_FILE_ICON_TOKEN,
  PIER_CUSTOM_FILE_ICON_TOKENS,
  PIER_DART_FILE_ICON_SYMBOL,
  PIER_DART_FILE_ICON_SYMBOL_ID,
  SIMPLE_ICONS_DART_PATH,
} from "./icon-glyphs.ts";

/**
 * Shared Pier file-icon overrides on top of `@pierre/trees` complete set.
 *
 * Canvas live modules (`.canvas.tsx` / `.canvas.vue` / …) have no industry-
 * standard file glyph in VS Code / Material Icon Theme / Pierre built-ins.
 * Closest common metaphor is a multi-panel dashboard layout (Lucide
 * `layout-dashboard`, Figma/artboard mosaics): a composed UI surface rather
 * than a language badge.
 *
 * L0 languages missing from the built-in complete sheet (Dart, Java, …) get
 * the same overlay treatment so tree rows and tabs share one token + symbol.
 *
 * Dart/YAML mapping follows industry icon themes, not a second glyph set:
 * `.dart` uses the official Dart silhouette; `pubspec.yaml` / `*.yaml` stay
 * on Pierre's built-in `yml` (Material Icon Theme). vscode-icons' colored
 * `flutter_package` mark is not in Pierre's 16×16 currentColor sheet.
 *
 * Filename remaps only reuse tokens that already exist in this sheet
 * (`npm` / `python` / `ruby` / …). No Makefile / Prisma / Nix glyphs —
 * those stay on the default file mark.
 */

/**
 * Compound extensions without a leading dot. Must stay equal (order-
 * independent) to `LIVE_MODULE_CANVAS_FILE_SUFFIXES` in
 * `src/shared/live-module-framework.ts` — locked by
 * `tests/unit/renderer/files/icon.test.tsx`. Package boundary: ui cannot import
 * host `shared/`. Trees resolver walks candidates from the full tail.
 */
export const PIER_CANVAS_FILE_EXTENSIONS = [
  "canvas.solid.tsx",
  "canvas.solid.jsx",
  "canvas.tsx",
  "canvas.jsx",
  "canvas.vue",
  "canvas.svelte",
] as const;

export const PIER_GO_FILE_NAMES = [
  "go.mod",
  "go.sum",
  "go.work",
  "go.work.sum",
] as const;

/** Material Icon Theme / vscode-icons: dart mark, not a YAML remap. */
export const PIER_DART_FILE_NAMES = [".pubignore"] as const;

export const PIER_MANIFEST_FILE_ICONS = {
  "Cargo.lock": "rust",
  "CMakeLists.txt": "cpp",
  "Directory.Build.props": "csharp",
  "Gemfile.lock": "ruby",
  LICENSE: "text",
  "Package.resolved": "swift",
  Pipfile: "python",
  "Pipfile.lock": "python",
  Podfile: "ruby",
  "Podfile.lock": "ruby",
  "composer.json": "php",
  "composer.lock": "php",
  "gradle.properties": "java",
  gradlew: "java",
  "gradlew.bat": "java",
  "mix.lock": "elixir",
  "package-lock.json": "npm",
  "package.json": "npm",
  "pnpm-lock.yaml": "npm",
  "poetry.lock": "python",
  "pubspec.lock": "yml",
  "requirements.txt": "python",
  "uv.lock": "python",
  "yarn.lock": "npm",
} as const;

/**
 * Custom sprite fragment for PierFileTree only (`icons.spriteSheet`).
 * Tab / standalone `PierFileIcon` merges the same symbols into the built-in
 * complete sheet via {@link mergeCustomFileIconsIntoBuiltInSpriteSheet}.
 */
export const PIER_FILE_ICON_CUSTOM_SPRITE_SHEET = `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true">${PIER_CUSTOM_FILE_ICON_SYMBOLS.join("")}</svg>`;

/**
 * Append Pier custom glyphs into a `@pierre/trees` built-in complete sprite
 * SVG for light-DOM `PierFileIcon` (single sheet, no second mount).
 */
export function mergeCustomFileIconsIntoBuiltInSpriteSheet(
  builtInSvg: string
): string {
  const missing = PIER_CUSTOM_FILE_ICON_SYMBOLS.filter(
    (markup) => !builtInSvg.includes(symbolIdFromMarkup(markup))
  );
  if (missing.length === 0) {
    return builtInSvg;
  }
  return builtInSvg.replace("</svg>", `${missing.join("\n")}\n</svg>`);
}

function symbolIdFromMarkup(markup: string): string {
  const match = markup.match(/\sid="([^"]+)"/);
  return match?.[1] ? `id="${match[1]}"` : markup;
}

/**
 * Runtime `token` is applied by `@pierre/trees` Icon but omitted from the
 * public `RemappedIcon` type — assert so typed config stays assignable.
 */
function tokenIcon(
  name: string,
  token: string
): RemappedIcon & { token: string } {
  return { name, token };
}

const CANVAS_FILE_ICON = tokenIcon(
  PIER_CANVAS_FILE_ICON_SYMBOL_ID,
  PIER_CANVAS_FILE_ICON_TOKEN
);
const DART_FILE_ICON = tokenIcon(PIER_DART_FILE_ICON_SYMBOL_ID, "dart");
const JAVA_FILE_ICON = tokenIcon(PIER_JAVA_FILE_ICON_SYMBOL_ID, "java");
const KOTLIN_FILE_ICON = tokenIcon(PIER_KOTLIN_FILE_ICON_SYMBOL_ID, "kotlin");
const CSHARP_FILE_ICON = tokenIcon(PIER_CSHARP_FILE_ICON_SYMBOL_ID, "csharp");
const PHP_FILE_ICON = tokenIcon(PIER_PHP_FILE_ICON_SYMBOL_ID, "php");
const ELIXIR_FILE_ICON = tokenIcon(PIER_ELIXIR_FILE_ICON_SYMBOL_ID, "elixir");
const LUA_FILE_ICON = tokenIcon(PIER_LUA_FILE_ICON_SYMBOL_ID, "lua");
const R_FILE_ICON = tokenIcon(PIER_R_FILE_ICON_SYMBOL_ID, "r");
const SCALA_FILE_ICON = tokenIcon(PIER_SCALA_FILE_ICON_SYMBOL_ID, "scala");
const TOML_FILE_ICON = tokenIcon(PIER_TOML_FILE_ICON_SYMBOL_ID, "toml");
const XML_FILE_ICON = tokenIcon(PIER_XML_FILE_ICON_SYMBOL_ID, "xml");
const DOCKER_FILE_ICON = tokenIcon("file-tree-builtin-docker", "docker");

const canvasByFileExtension = Object.fromEntries(
  PIER_CANVAS_FILE_EXTENSIONS.map((extension) => [extension, CANVAS_FILE_ICON])
) as Record<string, RemappedIcon>;

const GO_FILE_ICON = tokenIcon("file-tree-builtin-go", "go");
const CPP_FILE_ICON = tokenIcon("file-tree-builtin-cpp", "cpp");
const BASH_FILE_ICON = tokenIcon("file-tree-builtin-bash", "bash");
const ZIG_FILE_ICON = tokenIcon("file-tree-builtin-zig", "zig");
const TERRAFORM_FILE_ICON = tokenIcon(
  "file-tree-builtin-terraform",
  "terraform"
);
const RUST_FILE_ICON = tokenIcon("file-tree-builtin-rust", "rust");
const PYTHON_FILE_ICON = tokenIcon("file-tree-builtin-python", "python");
const RUBY_FILE_ICON = tokenIcon("file-tree-builtin-ruby", "ruby");
const NPM_FILE_ICON = tokenIcon("file-tree-builtin-npm", "npm");
const SWIFT_FILE_ICON = tokenIcon("file-tree-builtin-swift", "swift");
const TEXT_FILE_ICON = tokenIcon("file-tree-builtin-text", "text");
const YML_FILE_ICON = tokenIcon("file-tree-builtin-yml", "yml");

const MANIFEST_TOKEN_ICONS: Readonly<Record<string, RemappedIcon>> = {
  cpp: CPP_FILE_ICON,
  csharp: CSHARP_FILE_ICON,
  elixir: ELIXIR_FILE_ICON,
  java: JAVA_FILE_ICON,
  npm: NPM_FILE_ICON,
  php: PHP_FILE_ICON,
  python: PYTHON_FILE_ICON,
  ruby: RUBY_FILE_ICON,
  rust: RUST_FILE_ICON,
  swift: SWIFT_FILE_ICON,
  text: TEXT_FILE_ICON,
  yml: YML_FILE_ICON,
};

const manifestByFileName = Object.fromEntries(
  Object.entries(PIER_MANIFEST_FILE_ICONS).map(([fileName, token]) => [
    fileName,
    MANIFEST_TOKEN_ICONS[token],
  ])
) as Record<string, RemappedIcon>;

const goByFileName = Object.fromEntries(
  PIER_GO_FILE_NAMES.map((fileName) => [fileName, GO_FILE_ICON])
) as Record<string, RemappedIcon>;

const dartByFileName = Object.fromEntries(
  PIER_DART_FILE_NAMES.map((fileName) => [fileName, DART_FILE_ICON])
) as Record<string, RemappedIcon>;

/**
 * Single source for PierFileIcon + PierFileTree. Must keep `set: "complete"`
 * when adding overrides — otherwise trees defaults custom-only configs to
 * `set: "none"`.
 */
export const PIER_FILE_TREE_ICONS = {
  set: "complete",
  colored: true,
  spriteSheet: PIER_FILE_ICON_CUSTOM_SPRITE_SHEET,
  byFileName: {
    ...goByFileName,
    ...dartByFileName,
    ...manifestByFileName,
  },
  byFileExtension: {
    ...canvasByFileExtension,
    dart: DART_FILE_ICON,
    arb: DART_FILE_ICON,
    java: JAVA_FILE_ICON,
    gradle: JAVA_FILE_ICON,
    kt: KOTLIN_FILE_ICON,
    kts: KOTLIN_FILE_ICON,
    cs: CSHARP_FILE_ICON,
    csproj: CSHARP_FILE_ICON,
    fsproj: CSHARP_FILE_ICON,
    sln: CSHARP_FILE_ICON,
    php: PHP_FILE_ICON,
    ex: ELIXIR_FILE_ICON,
    exs: ELIXIR_FILE_ICON,
    eex: ELIXIR_FILE_ICON,
    heex: ELIXIR_FILE_ICON,
    leex: ELIXIR_FILE_ICON,
    lua: LUA_FILE_ICON,
    r: R_FILE_ICON,
    rmd: R_FILE_ICON,
    scala: SCALA_FILE_ICON,
    sbt: SCALA_FILE_ICON,
    sc: SCALA_FILE_ICON,
    toml: TOML_FILE_ICON,
    xml: XML_FILE_ICON,
    plist: XML_FILE_ICON,
    dockerfile: DOCKER_FILE_ICON,
    cmake: CPP_FILE_ICON,
    m: CPP_FILE_ICON,
    ps1: BASH_FILE_ICON,
    cmd: BASH_FILE_ICON,
    zon: ZIG_FILE_ICON,
    hcl: TERRAFORM_FILE_ICON,
  },
} as const satisfies FileTreeIcons;

export const PIER_CUSTOM_FILE_ICON_COLOR_CSS = PIER_CUSTOM_FILE_ICON_TOKENS.map(
  (token) =>
    `[data-file-tree-colored-icons="true"] [data-icon-token="${token}"] {\n  color: var(--trees-file-icon-color-${token});\n}`
).join("\n\n");

export function isCanvasFileIconName(fileName: string): boolean {
  const base = fileName.split(/[/\\]/u).at(-1) ?? fileName;
  const lowered = base.toLowerCase();
  return PIER_CANVAS_FILE_EXTENSIONS.some((extension) => {
    const suffix = `.${extension}`;
    return lowered.length > suffix.length && lowered.endsWith(suffix);
  });
}
