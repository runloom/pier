import { realpathSync } from "node:fs";
import { builtinModules } from "node:module";
import { isAbsolute, join, normalize, relative, sep } from "node:path";
import type { LiveRootSpec } from "@shared/contracts/live-modules.ts";
import {
  isFrameworkBarePackage,
  type LiveModuleFramework,
} from "@shared/live-module-framework.ts";

export class LiveModuleFenceError extends Error {
  readonly diagnosticMessage: string;

  constructor(message: string) {
    super(message);
    this.name = "LiveModuleFenceError";
    this.diagnosticMessage = message;
  }
}

/** Node / Electron surface — never bundle into a live module (any framework). */
const DENIED_BARE = new Set<string>([
  "electron",
  "process",
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);
// Subpath builtins used without full node: prefix in older graphs.
for (const name of ["fs/promises", "path/posix", "path/win32", "stream/web"]) {
  DENIED_BARE.add(name);
}

export function isDeniedBareSpecifier(
  specifier: string,
  allowNodeModules: boolean,
  framework: LiveModuleFramework = "react"
): boolean {
  if (specifier.startsWith("node:")) {
    return true;
  }
  if (specifier === "electron" || specifier.startsWith("electron/")) {
    return true;
  }
  if (DENIED_BARE.has(specifier)) {
    return true;
  }
  // Path aliases (@/, ~/, #) are not bare packages — resolve via tsconfig/fence.
  if (
    specifier.startsWith("@/") ||
    specifier.startsWith("~/") ||
    specifier.startsWith("#")
  ) {
    return false;
  }
  if (
    !(
      allowNodeModules ||
      specifier.startsWith(".") ||
      specifier.startsWith("/")
    )
  ) {
    // Host React singletons (aligned with __PIER_PLUGIN_SHARED__).
    if (
      specifier === "react" ||
      specifier.startsWith("react/") ||
      specifier === "react-dom" ||
      specifier === "react-dom/client" ||
      specifier === "pier/canvas" ||
      specifier === "pier/host"
    ) {
      return false;
    }
    if (specifier.startsWith("react-dom/")) {
      return true;
    }
    // Framework packages (vue / solid-js / svelte) are allowlisted; other bare
    // packages are denied for canvas source. Transitive node_modules importers
    // bypass this check in compile.ts via importerInNodeModules.
    if (framework !== "react" && isFrameworkBarePackage(specifier, framework)) {
      return false;
    }
    return true;
  }
  return false;
}

/**
 * After resolve: when bare packages are disallowed, also reject any path that
 * lands under a `node_modules` segment (relative or alias imports).
 */
export function assertNotNodeModulesPath(
  absolutePath: string,
  allowNodeModules: boolean,
  framework: LiveModuleFramework = "react"
): void {
  if (allowNodeModules) {
    return;
  }
  // Non-React canvases bundle the project's framework + its transitive deps.
  // Trust model remains “opened project”; React still forbids node_modules paths.
  if (framework !== "react") {
    return;
  }
  const parts = absolutePath.split(/[/\\]/u);
  if (parts.includes("node_modules")) {
    throw new LiveModuleFenceError(
      `import resolves under node_modules (disallowed): ${absolutePath}`
    );
  }
}

export function assertPathInsideRoot(
  candidatePath: string,
  rootPath: string,
  label: string
): string {
  let realCandidate: string;
  let realRoot: string;
  try {
    realCandidate = realpathSync(candidatePath);
    realRoot = realpathSync(rootPath);
  } catch {
    throw new LiveModuleFenceError(
      `${label} path does not exist or cannot be resolved: ${candidatePath}`
    );
  }
  const rel = relative(realRoot, realCandidate);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new LiveModuleFenceError(
      `${label} escapes allowed root (${realRoot}): ${candidatePath}`
    );
  }
  return realCandidate;
}

/** Realpath membership check (home root / opened project guards). */
export function isPathWithinRoot(
  candidatePath: string,
  rootPath: string
): boolean {
  try {
    const realCandidate = realpathSync(candidatePath);
    const realRoot = realpathSync(rootPath);
    if (realCandidate === realRoot) {
      return true;
    }
    const prefix = realRoot.endsWith(sep) ? realRoot : realRoot + sep;
    return realCandidate.startsWith(prefix);
  } catch {
    return false;
  }
}

export function resolveUnderRoot(
  rootPath: string,
  relativePath: string,
  label: string
): string {
  if (
    isAbsolute(relativePath) ||
    relativePath.split(/[/\\]/u).some((part) => part === "..")
  ) {
    throw new LiveModuleFenceError(
      `${label} must be a relative path without ..: ${relativePath}`
    );
  }
  const joined = normalize(join(rootPath, relativePath));
  return assertPathInsideRoot(joined, rootPath, label);
}

export function fenceRootForSpec(
  spec: LiveRootSpec,
  resolvedAnchorRoot: string
): { contentRoot: string; projectRoot: string | null } {
  if (spec.anchor.scope === "home") {
    const contentRoot = resolveUnderRoot(
      resolvedAnchorRoot,
      spec.directory,
      "home live root directory"
    );
    return { contentRoot, projectRoot: null };
  }
  const projectRoot = assertPathInsideRoot(
    resolvedAnchorRoot,
    resolvedAnchorRoot,
    "project root"
  );
  // Ensure directory exists or is creatable path under project — for fence of
  // canvas files we require the directory path to stay under project even if
  // missing (join without realpath on missing dir).
  const directoryJoined = normalize(join(projectRoot, spec.directory));
  const rel = relative(projectRoot, directoryJoined);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new LiveModuleFenceError(
      `project live root directory escapes project: ${spec.directory}`
    );
  }
  return { contentRoot: directoryJoined, projectRoot };
}
