import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

export interface ResolvePierCliBinOptions {
  env?: Record<string, string | undefined>;
  exists?: (path: string) => boolean;
  home?: string;
  which?: () => string | null;
}

function findPierInPath(): string | null {
  try {
    const found = execFileSync("which", ["pier"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return found.length > 0 ? found : null;
  } catch {
    return null;
  }
}

export function resolvePierCliBin({
  env = process.env,
  exists = existsSync,
  home = process.env.HOME,
  which = findPierInPath,
}: ResolvePierCliBinOptions = {}): string {
  if (env.PIER_CLI_PATH) {
    return env.PIER_CLI_PATH;
  }

  const found = which();
  if (found) {
    return found;
  }

  const macPaths = [
    "/Applications/Pier.app/Contents/Resources/bin/pier",
    ...(home
      ? [`${home}/Applications/Pier.app/Contents/Resources/bin/pier`]
      : []),
  ];
  for (const path of macPaths) {
    if (exists(path)) {
      return path;
    }
  }

  return "pier";
}
