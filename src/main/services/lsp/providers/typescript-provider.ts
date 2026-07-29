import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { LspServerProvider } from "@shared/contracts/lsp-provider.ts";
import {
  matchPathExtensions,
  normalizeFsRoot,
  resolveRootByMarkers,
} from "../resolve-root.ts";

const TS_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".cts",
  ".mts",
  ".js",
  ".jsx",
  ".cjs",
  ".mjs",
] as const;

const LANGUAGE_ID_BY_EXT: Readonly<Record<string, string>> = {
  ".cjs": "javascript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascriptreact",
  ".mjs": "javascript",
  ".mts": "typescript",
  ".ts": "typescript",
  ".tsx": "typescriptreact",
};

const ROOT_MARKERS = [
  "tsconfig.json",
  "jsconfig.json",
  "package.json",
] as const;

/**
 * Rewrite asar package paths to the unpacked sibling so ELECTRON_RUN_AS_NODE
 * can open the CLI (spawn/read against a packed asar path is fragile).
 * electron-builder asarUnpack lists typescript-language-server (+ typescript).
 */
export function resolveUnpackedAsarPath(absolutePath: string): string {
  return absolutePath
    .replaceAll("/app.asar/", "/app.asar.unpacked/")
    .replaceAll("\\app.asar\\", "\\app.asar.unpacked\\");
}

export function resolveBundledTypescriptLanguageServer(): {
  args: string[];
  command: string;
} | null {
  try {
    const require = createRequire(import.meta.url);
    const pkgJson = require.resolve("typescript-language-server/package.json");
    const cli = resolveUnpackedAsarPath(
      join(dirname(pkgJson), "lib", "cli.mjs")
    );
    return {
      args: [cli, "--stdio"],
      command: process.execPath,
    };
  } catch {
    return null;
  }
}

export function createTypescriptLspProvider(): LspServerProvider {
  return {
    displayName: "TypeScript/JavaScript",
    id: "typescript",
    priority: 100,
    rootMarkers: ROOT_MARKERS,
    selector: {
      extensions: TS_EXTENSIONS,
      languageIds: [
        "typescript",
        "typescriptreact",
        "javascript",
        "javascriptreact",
      ],
    },
    languageIdForPath(path) {
      const base = path.replace(/\\/g, "/");
      const slash = base.lastIndexOf("/");
      const name = slash >= 0 ? base.slice(slash + 1) : base;
      const dot = name.lastIndexOf(".");
      if (dot <= 0) {
        return null;
      }
      return LANGUAGE_ID_BY_EXT[name.slice(dot).toLowerCase()] ?? null;
    },
    matchPath(path) {
      return matchPathExtensions(path, TS_EXTENSIONS);
    },
    resolveLaunch({ rootPath }) {
      const bundled = resolveBundledTypescriptLanguageServer();
      if (!bundled) {
        return null;
      }
      return {
        args: bundled.args,
        command: bundled.command,
        cwd: normalizeFsRoot(rootPath),
        env: { ELECTRON_RUN_AS_NODE: "1" },
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
