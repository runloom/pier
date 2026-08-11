import type { LspServerProvider } from "@shared/contracts/lsp-provider.ts";
import { createPathLspProvider } from "./create-path-provider.ts";

export function createGoplsLspProvider(): LspServerProvider {
  return createPathLspProvider({
    args: [],
    command: "gopls",
    displayName: "Go (gopls)",
    extensions: [".go"],
    id: "gopls",
    installCommand: "go install golang.org/x/tools/gopls@latest",
    languageIds: ["go"],
    priority: 90,
    rootMarkers: ["go.mod", "go.work"],
    source: "core",
  });
}
