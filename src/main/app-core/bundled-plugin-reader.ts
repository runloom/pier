import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { isDevRuntime as defaultIsDevRuntime } from "../runtime-mode.ts";

/**
 * Reads a bundled plugin's manifest + tgz metadata for `BundledPluginRegistration`.
 *
 * Dev: sources live at `packages/plugin-<id>/{plugin.json, dist-pkg/*.tgz}`.
 * Prod: each official plugin is isolated under
 * `<Resources>/plugin-packages/<prodPluginDirName>/` so multiple plugins cannot
 * clobber a shared `plugin.json`.
 *
 * Returns null when the tgz + `.sha256` pair is missing (fresh checkout
 * before `pnpm plugins:pack`) so app-core can skip registration.
 */

export interface ReadBundledPluginOptions {
  readonly devPackageDir: string;
  readonly fallbackId: string;
  readonly fallbackName: string;
  readonly fallbackVersion: string;
  readonly prodPluginDirName: string;
}

export interface BundledPluginBundle {
  readonly archivePath: string;
  readonly contributionCounts: {
    readonly commands: number;
    readonly panels: number;
    readonly terminalStatusItems: number;
    readonly workbenchWidgets: number;
  };
  readonly description?: string;
  readonly locales?: Record<string, { name?: string; description?: string }>;
  readonly name: string;
  readonly sha256: string;
  readonly size?: number;
  readonly version: string;
}

export interface ReadBundledPluginRuntime {
  readonly cwd?: string;
  readonly isDevRuntime?: () => boolean;
  readonly resourcesPath?: string;
}

function pickLocalesSubset(
  raw: Record<string, { name?: string; description?: string }> | undefined
): Record<string, { name?: string; description?: string }> | undefined {
  if (!raw) return;
  const out: Record<string, { name?: string; description?: string }> = {};
  for (const [code, msgs] of Object.entries(raw)) {
    const pair: { name?: string; description?: string } = {};
    if (msgs.name) pair.name = msgs.name;
    if (msgs.description) pair.description = msgs.description;
    if (pair.name || pair.description) out[code] = pair;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function readBundledPlugin(
  options: ReadBundledPluginOptions,
  runtime: ReadBundledPluginRuntime = {}
): BundledPluginBundle | null {
  const isDev = (runtime.isDevRuntime ?? defaultIsDevRuntime)();
  const cwd = runtime.cwd ?? process.cwd();
  const resourcesPath = runtime.resourcesPath ?? process.resourcesPath ?? "";
  const bundleRoot = isDev
    ? join(cwd, options.devPackageDir, "dist-pkg")
    : join(resourcesPath, "plugin-packages", options.prodPluginDirName);
  // Dev keeps the editable source manifest at package root; prod packs a copy
  // of plugin.json next to the tgz under the per-plugin resource dir.
  const manifestSrcDir = isDev ? join(cwd, options.devPackageDir) : bundleRoot;
  const manifestPath = join(manifestSrcDir, "plugin.json");
  if (!existsSync(manifestPath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      id?: string;
      name?: string;
      description?: string;
      version?: string;
      commands?: unknown[];
      workbenchWidgets?: unknown[];
      missionControlWidgets?: unknown[];
      panels?: unknown[];
      terminalStatusItems?: unknown[];
      locales?: Record<string, { name?: string; description?: string }>;
    };
    const version = parsed.version ?? options.fallbackVersion;
    const id = parsed.id ?? options.fallbackId;
    if (id !== options.fallbackId) {
      return null;
    }
    const archivePath = join(bundleRoot, `${id}-${version}.tgz`);
    const shaPath = `${archivePath}.sha256`;
    if (!(existsSync(archivePath) && existsSync(shaPath))) {
      return null;
    }
    const sha256 = readFileSync(shaPath, "utf8").trim().split(/\s+/)[0];
    if (!sha256) {
      return null;
    }
    const size = statSync(archivePath).size;
    const localesSubset = pickLocalesSubset(parsed.locales);
    return {
      archivePath,
      contributionCounts: {
        commands: parsed.commands?.length ?? 0,
        workbenchWidgets:
          (parsed.workbenchWidgets ?? parsed.missionControlWidgets)?.length ??
          0,
        panels: parsed.panels?.length ?? 0,
        terminalStatusItems: parsed.terminalStatusItems?.length ?? 0,
      },
      name: parsed.name ?? options.fallbackName,
      sha256,
      size,
      version,
      ...(parsed.description ? { description: parsed.description } : {}),
      ...(localesSubset ? { locales: localesSubset } : {}),
    };
  } catch {
    return null;
  }
}
