import { realpathSync } from "node:fs";

/**
 * When the binary resolves into Homebrew Cellar/Caskroom, return the installed
 * package token (e.g. `claude-code@latest`). Specs often list the stable name
 * (`claude-code`); upgrading the wrong token yields "Cask is not installed".
 */
export function brewPackageTokenFromBinPath(
  binPath: string | null | undefined
): string | null {
  if (!binPath) {
    return null;
  }
  let resolved = binPath;
  try {
    resolved = realpathSync(binPath);
  } catch {
    // use binPath as-is
  }
  const p = resolved.replace(/\\/g, "/");
  const cask = p.match(/\/Caskroom\/([^/]+)\//i);
  if (cask?.[1]) {
    return decodeURIComponent(cask[1]);
  }
  const formula = p.match(/\/Cellar\/([^/]+)\//i);
  if (formula?.[1]) {
    return decodeURIComponent(formula[1]);
  }
  return null;
}
