/**
 * L0 language matrix — editor identity + PATH LSP single source of truth.
 * Bundled TypeScript and hybrid Vue stay in dedicated provider factories.
 */

export {
  asLspProviderDescriptor,
  editorBasenameRulesFromMatrix,
  editorExtensionMapFromMatrix,
  pathCatalogFromMatrix,
  pathLspDescriptorsFromMatrix,
} from "./derive.ts";
export { PATH_LANGUAGE_MATRIX } from "./path-rows.ts";
export type {
  LanguageMatrixLspSpec,
  LanguageMatrixRow,
  PathLspDescriptor,
} from "./types.ts";

/** Special non-PATH catalog rows (not derived from PATH_LANGUAGE_MATRIX). */
export const SPECIAL_LSP_CATALOG_ENTRIES = [
  {
    binaryHint: "bundled",
    displayName: "TypeScript / JavaScript",
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"],
    id: "typescript",
    source: "core" as const,
  },
  {
    binaryHint: "@vue/typescript-plugin|vue-language-server",
    displayName: "Vue",
    extensions: [".vue"],
    id: "vue",
    installCommand: "npm i -g @vue/language-server",
    source: "core" as const,
  },
] as const;
