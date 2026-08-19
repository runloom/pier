import { join } from "node:path";

export const PIER_APP_CLI_BASENAME = "pier";
export const DARWIN_ADMIN_BIN_DIR = "/usr/local/bin";

const BLOCKED_BIN_DIRS = new Set([
  "/bin",
  "/sbin",
  "/usr/bin",
  "/usr/libexec",
  "/usr/sbin",
]);

const PREFERRED_BIN_DIRS = ["/opt/homebrew/bin", DARWIN_ADMIN_BIN_DIR] as const;

export function packagedCliSourcePath(resourcesPath: string): string {
  return join(resourcesPath, "bin", PIER_APP_CLI_BASENAME);
}

export function packagedCliScriptPath(resourcesPath: string): string {
  return join(resourcesPath, "bin", "pier.mjs");
}

export function isBlockedBinDir(dir: string): boolean {
  const normalized = dir.replace(/\/+$/u, "") || "/";
  if (BLOCKED_BIN_DIRS.has(normalized)) {
    return true;
  }
  if (normalized.startsWith("/System/")) {
    return true;
  }
  if (normalized.includes("/node_modules/")) {
    return true;
  }
  if (normalized.includes(".app/Contents/")) {
    return true;
  }
  return false;
}

export function parsePathDirs(pathEnv: string): string[] {
  return pathEnv.split(":").filter((dir) => dir.length > 0);
}

export interface ResolveLinkCandidateInput {
  canWrite: (dir: string) => boolean;
  existsDir: (dir: string) => boolean;
  home: string;
  pathEnv: string;
  platform: NodeJS.Platform | string;
}

export interface AppCliLinkCandidate {
  linkPath: string;
  needsAdmin: boolean;
}

export function resolveLinkCandidate(
  input: ResolveLinkCandidateInput
): AppCliLinkCandidate | null {
  if (input.platform !== "darwin") {
    return null;
  }

  const pathDirs = parsePathDirs(input.pathEnv);
  const onPath = new Set(pathDirs);
  const localBin = join(input.home, ".local", "bin");
  const ranked = [...PREFERRED_BIN_DIRS, localBin];

  for (const dir of ranked) {
    if (isBlockedBinDir(dir) || !input.existsDir(dir)) {
      continue;
    }
    if (!(onPath.has(dir) || dir === DARWIN_ADMIN_BIN_DIR)) {
      continue;
    }
    if (input.canWrite(dir)) {
      return { linkPath: join(dir, PIER_APP_CLI_BASENAME), needsAdmin: false };
    }
  }

  for (const dir of pathDirs) {
    if (isBlockedBinDir(dir) || !input.existsDir(dir) || !input.canWrite(dir)) {
      continue;
    }
    return { linkPath: join(dir, PIER_APP_CLI_BASENAME), needsAdmin: false };
  }

  return {
    linkPath: join(DARWIN_ADMIN_BIN_DIR, PIER_APP_CLI_BASENAME),
    needsAdmin: true,
  };
}

export function looksLikePierAppCliTarget(target: string): boolean {
  return /\/Contents\/Resources\/bin\/pier$/u.test(target.replace(/\\/g, "/"));
}
