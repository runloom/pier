import type { LspCatalogEntry } from "@shared/contracts/lsp-provider.ts";

/**
 * Static L0 catalog for settings UI. Availability is probed separately.
 * Keep in sync with bootstrap-providers registration.
 * `installCommand` is owned here for core servers (not in Files plugin).
 */
export const CORE_LSP_CATALOG: readonly LspCatalogEntry[] = [
  {
    binaryHint: "bundled",
    displayName: "TypeScript / JavaScript",
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"],
    id: "typescript",
    source: "core",
  },
  {
    binaryHint: "pyright-langserver",
    displayName: "Python",
    extensions: [".py", ".pyi"],
    id: "pyright",
    installCommand: "npm i -g pyright",
    source: "core",
  },
  {
    binaryHint: "gopls",
    displayName: "Go",
    extensions: [".go"],
    id: "gopls",
    installCommand: "go install golang.org/x/tools/gopls@latest",
    source: "core",
  },
  {
    binaryHint: "rust-analyzer",
    displayName: "Rust",
    extensions: [".rs"],
    id: "rust-analyzer",
    installCommand: "rustup component add rust-analyzer",
    source: "core",
  },
  {
    binaryHint: "vscode-json-language-server",
    displayName: "JSON",
    extensions: [".json", ".jsonc"],
    id: "json",
    installCommand: "npm i -g vscode-langservers-extracted",
    source: "core",
  },
  {
    binaryHint: "vscode-css-language-server",
    displayName: "CSS / SCSS",
    extensions: [".css", ".scss"],
    id: "css",
    installCommand: "npm i -g vscode-langservers-extracted",
    source: "core",
  },
  {
    binaryHint: "vscode-html-language-server",
    displayName: "HTML",
    extensions: [".html", ".htm"],
    id: "html",
    installCommand: "npm i -g vscode-langservers-extracted",
    source: "core",
  },
  {
    binaryHint: "yaml-language-server",
    displayName: "YAML",
    extensions: [".yaml", ".yml"],
    id: "yaml",
    installCommand: "npm i -g yaml-language-server",
    source: "core",
  },
  {
    binaryHint: "marksman",
    displayName: "Markdown",
    extensions: [".md", ".mdx"],
    id: "markdown",
    installCommand: "brew install marksman",
    source: "core",
  },
  {
    // Plugin discovered from workspace / vue-language-server install; TLS is bundled.
    binaryHint: "@vue/typescript-plugin|vue-language-server",
    displayName: "Vue",
    extensions: [".vue"],
    id: "vue",
    installCommand: "npm i -g @vue/language-server",
    source: "core",
  },
  {
    binaryHint: "svelteserver|svelte-language-server",
    displayName: "Svelte",
    extensions: [".svelte"],
    id: "svelte",
    installCommand: "npm i -g svelte-language-server",
    source: "core",
  },
] as const;
