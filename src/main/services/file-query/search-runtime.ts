/**
 * Resolve the packaged (or injected) content-search executable.
 *
 * Design: docs/superpowers/specs/2026-07-27-files-content-search-design.md §5.1
 *
 * Never falls back to `PATH` — dev and install packages must resolve the same
 * application-owned binary so missing packaging fails loudly.
 */

import { accessSync, constants } from "node:fs";
import { arch as osArch } from "node:os";
import { join } from "node:path";

export type SearchRuntimeArch = "arm64" | "x64";

export type SearchRuntimeResolution =
  | {
      readonly kind: "available";
      readonly arch: SearchRuntimeArch;
      readonly executablePath: string;
      readonly source: "env" | "resources" | "inject";
    }
  | {
      readonly kind: "unavailable";
      readonly arch: SearchRuntimeArch;
      readonly tried: readonly string[];
    };

export interface ResolveSearchRuntimeOptions {
  /** Override `process.env.PIER_RG_PATH`. */
  readonly envPath?: string | null | undefined;
  /** Override host arch mapping. */
  readonly hostArch?: string | undefined;
  /** Absolute path override (tests / diagnostics). */
  readonly injectPath?: string | undefined;
  /** @deprecated Prefer `projectRoots`. Single project root convenience. */
  readonly projectRoot?: string | undefined;
  /** Repo / workspace roots that own a `resources/search/<arch>/rg` tree. */
  readonly projectRoots?: readonly string[] | undefined;
  /** @deprecated Prefer `resourcesRoots`. Single resources root convenience. */
  readonly resourcesRoot?: string | undefined;
  /**
   * Resource roots that already contain `search/<arch>/rg` as a relative path
   * (e.g. `process.resourcesPath` in packaged builds, or `…/resources` in dev).
   */
  readonly resourcesRoots?: readonly string[] | undefined;
}

function mapHostArch(hostArch: string): SearchRuntimeArch {
  if (hostArch === "arm64" || hostArch === "aarch64") return "arm64";
  return "x64";
}

function isExecutableFile(path: string): boolean {
  try {
    // F_OK | X_OK — both flags required; bitwise OR is intentional (node:fs).
    // biome-ignore lint/suspicious/noBitwiseOperators: node access mode flags
    accessSync(path, constants.F_OK | constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Candidate resource-relative layout: `search/<arch>/rg`
 * (design task 6 packaging input).
 */
export function searchRuntimeResourceRelativePath(
  arch: SearchRuntimeArch
): string {
  return join("search", arch, "rg");
}

export function resolveSearchRuntime(
  options: ResolveSearchRuntimeOptions = {}
): SearchRuntimeResolution {
  const arch = mapHostArch(options.hostArch ?? osArch());
  const tried: string[] = [];

  if (options.injectPath) {
    tried.push(options.injectPath);
    if (isExecutableFile(options.injectPath)) {
      return {
        kind: "available",
        arch,
        executablePath: options.injectPath,
        source: "inject",
      };
    }
  }

  const envPath =
    options.envPath === undefined
      ? process.env.PIER_RG_PATH
      : (options.envPath ?? undefined);
  if (envPath) {
    tried.push(envPath);
    if (isExecutableFile(envPath)) {
      return {
        kind: "available",
        arch,
        executablePath: envPath,
        source: "env",
      };
    }
  }

  const relative = searchRuntimeResourceRelativePath(arch);
  const roots: string[] = [];

  const pushRoot = (root: string | undefined): void => {
    if (!root || roots.includes(root)) return;
    roots.push(root);
  };

  for (const root of options.resourcesRoots ?? []) pushRoot(root);
  pushRoot(options.resourcesRoot);
  for (const project of options.projectRoots ?? []) {
    pushRoot(join(project, "resources"));
  }
  if (options.projectRoot) {
    pushRoot(join(options.projectRoot, "resources"));
  }
  // electron packaged / PierDev.app default
  if (typeof process.resourcesPath === "string" && process.resourcesPath) {
    pushRoot(process.resourcesPath);
  }

  for (const root of roots) {
    const candidate = join(root, relative);
    if (tried.includes(candidate)) continue;
    tried.push(candidate);
    if (isExecutableFile(candidate)) {
      return {
        kind: "available",
        arch,
        executablePath: candidate,
        source: "resources",
      };
    }
  }

  return { kind: "unavailable", arch, tried };
}
