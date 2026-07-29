import { spawnSync } from "node:child_process";
import type { LspServerProvider } from "@shared/contracts/lsp-provider.ts";
import {
  matchPathExtensions,
  normalizeFsRoot,
  resolveRootByMarkers,
} from "../resolve-root.ts";

const PY_EXTENSIONS = [".py", ".pyi"] as const;

const ROOT_MARKERS = [
  "pyproject.toml",
  "pyrightconfig.json",
  "setup.cfg",
  "setup.py",
] as const;

const CANDIDATES = ["pyright-langserver", "basedpyright-langserver"];

function resolvePyrightBinary(): string | null {
  for (const candidate of CANDIDATES) {
    const resolved = tryResolveCommand(candidate);
    if (resolved) {
      return resolved;
    }
  }
  return null;
}

function tryResolveCommand(command: string): string | null {
  // Use spawnSync (no shell) to avoid platform-specific null device issues.
  const probe = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(probe, [command], {
    encoding: "utf8",
    timeout: 3000,
  });
  if (result.status !== 0 || !result.stdout) {
    return null;
  }
  const path = result.stdout.split(/\r?\n/, 1)[0]?.trim();
  return path && path.length > 0 ? path : null;
}

function resolvePyrightCommand(binary: string): {
  args: string[];
  command: string;
} | null {
  if (process.platform !== "win32" || !/\.(?:bat|cmd)$/i.test(binary)) {
    return { args: ["--stdio"], command: binary };
  }
  if (/["\r\n]/.test(binary)) {
    return null;
  }
  return {
    args: ["/d", "/s", "/c", `"${binary}" --stdio`],
    command: process.env.ComSpec ?? "cmd.exe",
  };
}

export function createPyrightLspProvider(): LspServerProvider {
  return {
    displayName: "Python (Pyright)",
    id: "pyright",
    priority: 90,
    rootMarkers: ROOT_MARKERS,
    selector: {
      extensions: PY_EXTENSIONS,
      languageIds: ["python"],
    },
    languageIdForPath(path) {
      const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
      if (ext === ".py" || ext === ".pyi") {
        return "python";
      }
      return null;
    },
    matchPath(path) {
      return matchPathExtensions(path, PY_EXTENSIONS);
    },
    resolveLaunch({ rootPath }) {
      const bin = resolvePyrightBinary();
      if (!bin) {
        return null;
      }
      const command = resolvePyrightCommand(bin);
      return command
        ? {
            ...command,
            cwd: normalizeFsRoot(rootPath),
          }
        : null;
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
