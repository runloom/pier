import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { isDevRuntime } from "../runtime-mode.ts";

/**
 * Reads a bundled plugin's manifest + tgz metadata for `BundledPluginRegistration`.
 *
 * Dev: sources live at `packages/plugin-<id>/{plugin.json, dist-pkg/*.tgz}`.
 * Prod: from `<Resources>/plugin-packages/` alongside the tgz produced by
 * `scripts/pack-plugin.mjs`.
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
    readonly workbenchWidgets: number;
    readonly panels: number;
    readonly terminalStatusItems: number;
  };
  readonly description?: string;
  readonly locales?: Record<string, { name?: string; description?: string }>;
  readonly name: string;
  readonly sha256: string;
  readonly size?: number;
  readonly version: string;
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
  options: ReadBundledPluginOptions
): BundledPluginBundle | null {
  const bundleRoot = isDevRuntime()
    ? join(process.cwd(), options.devPackageDir, "dist-pkg")
    : join(process.resourcesPath ?? "", "plugin-packages");
  const manifestSrcDir = isDevRuntime()
    ? join(process.cwd(), options.devPackageDir)
    : bundleRoot;
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
