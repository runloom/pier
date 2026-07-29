import { spawnSync } from "node:child_process";
import type { LspServerProvider } from "@shared/contracts/lsp-provider.ts";
import {
  matchPathExtensions,
  normalizeFsRoot,
  resolveRootByMarkers,
} from "../resolve-root.ts";

const RS_EXTENSIONS = [".rs"] as const;

const ROOT_MARKERS = ["Cargo.toml"] as const;

function resolveRustAnalyzerBinary(): string | null {
  return tryResolveCommand("rust-analyzer");
}

function tryResolveCommand(command: string): string | null {
  const probe = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(probe, [command], {
    encoding: "utf8",
    timeout: 3000,
  });
  if (result.status !== 0 || !result.stdout) {
    return null;
  }
  const path = result.stdout.trim().split("\n")[0];
  return path && path.length > 0 ? path : null;
}

export function createRustAnalyzerLspProvider(): LspServerProvider {
  return {
    displayName: "Rust (rust-analyzer)",
    id: "rust-analyzer",
    priority: 90,
    rootMarkers: ROOT_MARKERS,
    selector: {
      extensions: RS_EXTENSIONS,
      languageIds: ["rust"],
    },
    languageIdForPath(path) {
      if (path.toLowerCase().endsWith(".rs")) {
        return "rust";
      }
      return null;
    },
    matchPath(path) {
      return matchPathExtensions(path, RS_EXTENSIONS);
    },
    resolveLaunch({ rootPath }) {
      const bin = resolveRustAnalyzerBinary();
      if (!bin) {
        return null;
      }
      return {
        args: [],
        command: bin,
        cwd: normalizeFsRoot(rootPath),
      };
    },
    resolveRoot(input) {
      return resolveRootByMarkers({
        fallbackWorkspaceRoot: input.fallbackWorkspaceRoot,
        filePath: input.filePath,
        markers: ROOT_MARKERS,
      });
    },
  };
}
