import type { InstallChannel, UpdateChannel } from "../specs/types.ts";

/** Install source from path-enum (npm/brew/uv/…/path). */
export type InstallSourceHint = string | null | undefined;

export type UpdateChannelKind = UpdateChannel["kind"];

const NPM_FAMILY = new Set([
  "npm",
  "nvm",
  "fnm",
  "volta",
  "pnpm",
  "yarn",
  "bun",
]);

/** Node/JS package managers that map to npm install/update channels. */
export function isNpmFamilySource(source: InstallSourceHint): boolean {
  return NPM_FAMILY.has((source ?? "").toLowerCase());
}

/**
 * Native / script / Scoop / WinGet / empty: prefer self then reinstall,
 * not a package-manager-only filter.
 */
export function isPathLikeSource(source: InstallSourceHint): boolean {
  const s = (source ?? "").toLowerCase();
  return (
    s === "" ||
    s === "path" ||
    s === "wsl" ||
    s === "scoop" ||
    s === "winget" ||
    s === "choco"
  );
}

/**
 * Preferred update channel kinds per install source (ordered).
 * Intersection with the agent’s declared `update[]` is the plan.
 */
const UPDATE_PRIORITY: Readonly<Record<string, readonly UpdateChannelKind[]>> =
  {
    npm: ["self", "npm-latest", "reinstall"],
    nvm: ["self", "npm-latest", "reinstall"],
    fnm: ["self", "npm-latest", "reinstall"],
    volta: ["self", "npm-latest", "reinstall"],
    pnpm: ["self", "npm-latest", "reinstall"],
    yarn: ["self", "npm-latest", "reinstall"],
    bun: ["self", "npm-latest", "reinstall"],
    brew: ["brew-upgrade", "self", "npm-latest", "reinstall"],
    pipx: ["pipx-upgrade", "reinstall"],
    uv: ["uv-upgrade", "reinstall"],
  };

function pathLikeOrder(channels: readonly UpdateChannel[]): UpdateChannel[] {
  const rest = channels.filter(
    (c) => c.kind !== "self" && c.kind !== "reinstall"
  );
  // Preserve relative order of self vs reinstall as declared on the agent
  // spec (cursor prefers reinstall over self; kiro prefers self first).
  const preferred: UpdateChannel[] = [];
  for (const c of channels) {
    if (c.kind === "self" || c.kind === "reinstall") {
      preferred.push(c);
    }
  }
  if (preferred.length > 0) {
    return [...preferred, ...rest];
  }
  return [...channels];
}

function pickByPriority(
  channels: readonly UpdateChannel[],
  priority: readonly UpdateChannelKind[]
): UpdateChannel[] {
  const byKind = new Map<UpdateChannelKind, UpdateChannel[]>();
  for (const c of channels) {
    const list = byKind.get(c.kind) ?? [];
    list.push(c);
    byKind.set(c.kind, list);
  }
  const out: UpdateChannel[] = [];
  for (const kind of priority) {
    const list = byKind.get(kind);
    if (list) {
      out.push(...list);
    }
  }
  return out;
}

export function filterUpdateChannels(
  channels: readonly UpdateChannel[],
  source: InstallSourceHint,
  options: { hasBrewInstall?: boolean } = {}
): UpdateChannel[] {
  const s = (source ?? "").toLowerCase();

  if (isPathLikeSource(s)) {
    return pathLikeOrder(channels);
  }

  // Tools may report a path containing "uv" without exact source "uv".
  const key = s === "uv" || s.includes("uv") ? "uv" : s;
  const priority = UPDATE_PRIORITY[key];
  if (!priority) {
    // Unknown source: keep self when declared.
    return pathLikeOrder(channels);
  }

  const picked = pickByPriority(channels, priority);
  if (picked.length > 0) {
    return picked;
  }
  if (channels.some((c) => c.kind === "reinstall")) {
    return [{ kind: "reinstall" }];
  }
  if (priority.includes("brew-upgrade") && options.hasBrewInstall === true) {
    return [{ kind: "brew-upgrade" }];
  }
  return [...channels];
}

/** Prefer install channels that match detected source. */
export function filterInstallChannels(
  channels: readonly InstallChannel[],
  source: InstallSourceHint
): readonly InstallChannel[] {
  const s = (source ?? "").toLowerCase();
  if (isNpmFamilySource(s)) {
    const npm = channels.filter((c) => c.kind === "npm");
    return npm.length > 0 ? npm : channels;
  }
  if (s === "brew") {
    const brew = channels.filter((c) => c.kind === "brew");
    return brew.length > 0 ? brew : channels;
  }
  if (s === "pipx") {
    const pipx = channels.filter((c) => c.kind === "pipx");
    return pipx.length > 0 ? pipx : channels;
  }
  if (s === "uv" || s.includes("uv")) {
    const uv = channels.filter((c) => c.kind === "uv");
    return uv.length > 0 ? uv : channels;
  }
  if (s === "path" || s === "wsl") {
    const scripts = channels.filter((c) => c.kind === "official-script");
    return scripts.length > 0 ? scripts : channels;
  }
  return channels;
}

/** Which reinstall steps match a source (for update reinstall expansion). */
export function reinstallStepMatchesSource(
  step: { kind: string; file?: string },
  source: InstallSourceHint
): boolean {
  const s = (source ?? "").toLowerCase();
  if (step.kind === "official-script") {
    return isPathLikeSource(s);
  }
  if (step.kind !== "argv" || !step.file) {
    return false;
  }
  if (isNpmFamilySource(s) && step.file === "npm") {
    return true;
  }
  if (s === "brew" && step.file === "brew") {
    return true;
  }
  if (s === "pipx" && step.file === "pipx") {
    return true;
  }
  if ((s === "uv" || s.includes("uv")) && step.file === "uv") {
    return true;
  }
  return isPathLikeSource(s);
}
