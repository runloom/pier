import type { LspServerProvider } from "@shared/contracts/lsp-provider.ts";
import { createPathLspProvider } from "./create-path-provider.ts";

export function createRustAnalyzerLspProvider(): LspServerProvider {
  return createPathLspProvider({
    args: [],
    command: "rust-analyzer",
    displayName: "Rust (rust-analyzer)",
    extensions: [".rs"],
    id: "rust-analyzer",
    installCommand: "rustup component add rust-analyzer",
    languageIds: ["rust"],
    priority: 90,
    rootMarkers: ["Cargo.toml"],
    source: "core",
  });
}
