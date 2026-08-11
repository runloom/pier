import type { LspServerProvider } from "@shared/contracts/lsp-provider.ts";
import { createPathLspProvider } from "./create-path-provider.ts";

export function createPyrightLspProvider(): LspServerProvider {
  return createPathLspProvider({
    args: ["--stdio"],
    command: "pyright-langserver",
    commandCandidates: ["pyright-langserver", "basedpyright-langserver"],
    displayName: "Python (Pyright)",
    extensions: [".py", ".pyi"],
    id: "pyright",
    installCommand: "npm i -g pyright",
    languageIds: ["python"],
    priority: 90,
    rootMarkers: [
      "pyproject.toml",
      "pyrightconfig.json",
      "setup.cfg",
      "setup.py",
    ],
    source: "core",
  });
}
