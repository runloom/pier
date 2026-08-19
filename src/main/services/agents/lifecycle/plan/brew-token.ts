import { realpathSync } from "node:fs";

export interface BrewNameChannel {
  formula: string;
  tap?: string;
}

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

/** Spec token: tap-qualified when the channel declares a tap. */
export function brewQualifiedName(channel: BrewNameChannel): string {
  return channel.tap ? `${channel.tap}/${channel.formula}` : channel.formula;
}

/**
 * Prefer the actually-installed cask/formula name when known
 * (e.g. `claude-code@latest` vs `claude-code`). When Cellar reports the bare
 * formula name but the spec has a tap, keep the tap-qualified token so
 * third-party taps (anomalyco/tap/opencode) query/upgrade the right package.
 */
export function resolveBrewQueryName(
  channel: BrewNameChannel,
  installedToken?: string | null
): string {
  const specName = brewQualifiedName(channel);
  if (!installedToken || installedToken.length === 0) {
    return specName;
  }
  const bare = channel.formula;
  const isBareMatch =
    installedToken === bare || installedToken.endsWith(`/${bare}`);
  if (channel.tap && isBareMatch && !installedToken.includes("@")) {
    return specName;
  }
  return installedToken;
}
