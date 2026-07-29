import { spawnSync } from "node:child_process";
import type { LspServerProvider } from "@shared/contracts/lsp-provider.ts";
import {
  matchPathExtensions,
  normalizeFsRoot,
  resolveRootByMarkers,
} from "../resolve-root.ts";

const GO_EXTENSIONS = [".go"] as const;

const ROOT_MARKERS = ["go.mod", "go.work"] as const;

function resolveGoplsBinary(): string | null {
  return tryResolveCommand("gopls");
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

export function createGoplsLspProvider(): LspServerProvider {
  return {
    displayName: "Go (gopls)",
    id: "gopls",
    priority: 90,
    rootMarkers: ROOT_MARKERS,
    selector: {
      extensions: GO_EXTENSIONS,
      languageIds: ["go"],
    },
    languageIdForPath(path) {
      if (path.toLowerCase().endsWith(".go")) {
        return "go";
      }
      return null;
    },
    matchPath(path) {
      return matchPathExtensions(path, GO_EXTENSIONS);
    },
    resolveLaunch({ rootPath }) {
      const bin = resolveGoplsBinary();
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
