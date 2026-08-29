/**
 * Custom file-icon symbols overlayed on `@pierre/trees` complete set.
 * 16×16, `currentColor`. Canvas is a Pier product glyph; the rest fill L0
 * language holes the built-in sheet does not ship.
 */

export const PIER_CANVAS_FILE_ICON_SYMBOL_ID = "file-tree-pier-canvas";
export const PIER_CANVAS_FILE_ICON_TOKEN = "canvas";

export const PIER_CANVAS_FILE_ICON_SYMBOL = `<symbol id="${PIER_CANVAS_FILE_ICON_SYMBOL_ID}" viewBox="0 0 16 16"><path fill="currentColor" d="M2.5 1.5h4a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1zm6.5 0h4.5a1 1 0 0 1 1 1v2.5a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V2.5a1 1 0 0 1 1-1zM1.5 11a1 1 0 0 1 1-1H5a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H2.5a1 1 0 0 1-1-1zm6.5 0a1 1 0 0 1 1-1h4.5a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1z"/></symbol>`;

function symbol(id: string, path: string): string {
  return `<symbol id="${id}" viewBox="0 0 16 16"><path fill="currentColor" d="${path}"/></symbol>`;
}

export const PIER_DART_FILE_ICON_SYMBOL_ID = "file-tree-pier-dart";
export const PIER_JAVA_FILE_ICON_SYMBOL_ID = "file-tree-pier-java";
export const PIER_KOTLIN_FILE_ICON_SYMBOL_ID = "file-tree-pier-kotlin";
export const PIER_CSHARP_FILE_ICON_SYMBOL_ID = "file-tree-pier-csharp";
export const PIER_PHP_FILE_ICON_SYMBOL_ID = "file-tree-pier-php";
export const PIER_ELIXIR_FILE_ICON_SYMBOL_ID = "file-tree-pier-elixir";
export const PIER_LUA_FILE_ICON_SYMBOL_ID = "file-tree-pier-lua";
export const PIER_R_FILE_ICON_SYMBOL_ID = "file-tree-pier-r";
export const PIER_SCALA_FILE_ICON_SYMBOL_ID = "file-tree-pier-scala";
export const PIER_TOML_FILE_ICON_SYMBOL_ID = "file-tree-pier-toml";
export const PIER_XML_FILE_ICON_SYMBOL_ID = "file-tree-pier-xml";

/**
 * Official Dart brand path from Simple Icons (`icons/dart.svg`, 24×24).
 * Same silhouette as vscode-icons `file_type_dartlang` / Material `dart.svg`.
 * Pierre has no `lang-dart`; Swift/Go in that set are 16×16 redraws with
 * interior air, not a 24×24 brand canvas scaled to the slot edges.
 * `evenodd` keeps the fold as negative space (Pierre C / Kotlin); 1.5px
 * inset matches those language marks' optical padding.
 */
export const SIMPLE_ICONS_DART_PATH =
  "M4.105 4.105S9.158 1.58 11.684.316a3.079 3.079 0 0 1 1.481-.315c.766.047 1.677.788 1.677.788L24 9.948v9.789h-4.263V24H9.789l-9-9C.303 14.5 0 13.795 0 13.105c0-.319.18-.818.316-1.105l3.789-7.895zm.679.679v11.787c.002.543.021 1.024.498 1.508L10.204 23h8.533v-4.263L4.784 4.784zm12.055-.678c-.899-.896-1.809-1.78-2.74-2.643-.302-.267-.567-.468-1.07-.462-.37.014-.87.195-.87.195L6.341 4.105l10.498.001z";

export const PIER_DART_FILE_ICON_SYMBOL = `<symbol id="${PIER_DART_FILE_ICON_SYMBOL_ID}" viewBox="0 0 16 16"><g transform="translate(1.5 1.5) scale(0.54167)"><path fill="currentColor" fill-rule="evenodd" d="${SIMPLE_ICONS_DART_PATH}"/></g></symbol>`;

export const PIER_JAVA_FILE_ICON_SYMBOL = symbol(
  PIER_JAVA_FILE_ICON_SYMBOL_ID,
  "M4.2 6.1h7.2v4.1A2.4 2.4 0 0 1 9 12.6H6.6A2.4 2.4 0 0 1 4.2 10.2zm7.2.7h1.2a1.6 1.6 0 0 1 0 3.2h-1.2M5.3 3.2c.6.5 1.4.5 2 0 .6.5 1.4.5 2 0"
);

export const PIER_KOTLIN_FILE_ICON_SYMBOL = symbol(
  PIER_KOTLIN_FILE_ICON_SYMBOL_ID,
  "M2.4 2.4h5.4L13.6 8 7.8 13.6H2.4zm1.6 1.7v7.8L11.1 8 4 4.1z"
);

export const PIER_CSHARP_FILE_ICON_SYMBOL = symbol(
  PIER_CSHARP_FILE_ICON_SYMBOL_ID,
  "M5.4 2.6h1.3l-.35 2.3h2.3l.35-2.3h1.3l-.35 2.3H12v1.25h-1.85L9.9 8.4H12V9.7H9.7l-.4 2.7H8l.4-2.7H6.1l-.4 2.7H4.4l.4-2.7H2.8V8.4h1.8l.25-2.25H2.8V4.9h2.25zm1.2 4.55.25-2.25h2.3L8.9 7.15z"
);

export const PIER_PHP_FILE_ICON_SYMBOL = symbol(
  PIER_PHP_FILE_ICON_SYMBOL_ID,
  "M8 3.4c3.9 0 6.2 1.6 6.2 4.6S11.9 12.6 8 12.6 1.8 11 1.8 8 4.1 3.4 8 3.4M5.6 6.5h1.55c.85 0 1.25.38 1.25 1.08 0 .78-.5 1.17-1.35 1.17H6.4L6.1 10.4H5.2zm1.1 1.55h.4c.28 0 .45-.12.45-.32s-.14-.3-.42-.3h-.3zM9.3 6.5h1.5c.68 0 1.08.34 1.08.98 0 .52-.26.86-.75.98l.7 1.94h-1.02L10 8.55h-.38L9.4 10.4H8.38zm.9 1.5h.38c.24 0 .4-.12.4-.32s-.12-.3-.38-.3h-.3z"
);

export const PIER_ELIXIR_FILE_ICON_SYMBOL = symbol(
  PIER_ELIXIR_FILE_ICON_SYMBOL_ID,
  "M8 1.7c2.7 3.1 4.3 5.3 4.3 7.4A4.3 4.3 0 1 1 3.7 9.1C3.7 7 5.3 4.8 8 1.7m0 4.2a2.9 2.9 0 0 0-2.5 3.2c0 1.4 1.1 2.6 2.5 2.6s2.5-1.2 2.5-2.6A2.9 2.9 0 0 0 8 5.9z"
);

export const PIER_LUA_FILE_ICON_SYMBOL = symbol(
  PIER_LUA_FILE_ICON_SYMBOL_ID,
  "M9.3 2.3a5.9 5.9 0 1 0 4.3 9.1 4.6 4.6 0 1 1-4.3-9.1M11.4 4.2a1.1 1.1 0 1 1-2.2 0 1.1 1.1 0 0 1 2.2 0"
);

export const PIER_R_FILE_ICON_SYMBOL = symbol(
  PIER_R_FILE_ICON_SYMBOL_ID,
  "M4.2 2.8h4.2c2.25 0 3.6 1.25 3.6 3.1 0 1.4-.85 2.45-2.15 2.85L12.2 13h-1.75l-2-3.85H5.65V13H4.2zm1.45 1.4v4.25h2.6c1.3 0 2.1-.7 2.1-2.12s-.8-2.13-2.1-2.13z"
);

export const PIER_SCALA_FILE_ICON_SYMBOL = symbol(
  PIER_SCALA_FILE_ICON_SYMBOL_ID,
  "M2.8 2.4 8 1.4l5.2 1v1.9L8 5.3 2.8 4.3zm0 4.2L8 5.6l5.2 1v1.9L8 9.5 2.8 8.5zm0 4.2L8 9.8l5.2 1v1.9l-5.2 1-5.2-1z"
);

export const PIER_TOML_FILE_ICON_SYMBOL = symbol(
  PIER_TOML_FILE_ICON_SYMBOL_ID,
  "M2.4 3.4h3.3v1.2H3.7v6.8h2v1.2H2.4zm8 0h3.2v9.2h-3.2v-1.2h2V4.6h-2zM6.1 6.6h3.8v1.8H6.1z"
);

export const PIER_XML_FILE_ICON_SYMBOL = symbol(
  PIER_XML_FILE_ICON_SYMBOL_ID,
  "M5.5 3.2 1.7 8l3.8 4.8 1.15-.92L3.85 8l2.8-3.88zm5 0-1.15.92L12.15 8l-2.8 3.88 1.15.92L14.3 8z"
);

export const PIER_CUSTOM_FILE_ICON_SYMBOLS: readonly string[] = [
  PIER_CANVAS_FILE_ICON_SYMBOL,
  PIER_DART_FILE_ICON_SYMBOL,
  PIER_JAVA_FILE_ICON_SYMBOL,
  PIER_KOTLIN_FILE_ICON_SYMBOL,
  PIER_CSHARP_FILE_ICON_SYMBOL,
  PIER_PHP_FILE_ICON_SYMBOL,
  PIER_ELIXIR_FILE_ICON_SYMBOL,
  PIER_LUA_FILE_ICON_SYMBOL,
  PIER_R_FILE_ICON_SYMBOL,
  PIER_SCALA_FILE_ICON_SYMBOL,
  PIER_TOML_FILE_ICON_SYMBOL,
  PIER_XML_FILE_ICON_SYMBOL,
];

/** Tokens that are not in `@pierre/trees` built-in colored-icon CSS. */
export const PIER_CUSTOM_FILE_ICON_TOKENS = [
  PIER_CANVAS_FILE_ICON_TOKEN,
  "dart",
  "java",
  "kotlin",
  "csharp",
  "php",
  "elixir",
  "lua",
  "r",
  "scala",
  "toml",
  "xml",
] as const;

export type PierCustomFileIconToken =
  (typeof PIER_CUSTOM_FILE_ICON_TOKENS)[number];
