import type { BundledPluginRegistration } from "../services/managed-plugins/install-operations.ts";
import {
  type BundledPluginBundle,
  readBundledPlugin,
} from "./bundled-plugin-reader.ts";

export interface OfficialBundledPluginSpec {
  devPackageDir: string;
  fallbackId: string;
  fallbackName: string;
  fallbackVersion: string;
  id: string;
  prodPluginDirName: string;
}

export const OFFICIAL_BUNDLED_PLUGIN_SPECS: readonly OfficialBundledPluginSpec[] =
  [
    {
      devPackageDir: "packages/plugin-codex",
      fallbackId: "pier.codex",
      fallbackName: "Codex",
      fallbackVersion: "1.0.0",
      id: "pier.codex",
      prodPluginDirName: "pier.codex",
    },
    {
      devPackageDir: "packages/plugin-grok",
      fallbackId: "pier.grok",
      fallbackName: "Grok",
      fallbackVersion: "1.0.0",
      id: "pier.grok",
      prodPluginDirName: "pier.grok",
    },
    {
      devPackageDir: "packages/plugin-ssh",
      fallbackId: "pier.ssh",
      fallbackName: "SSH Hosts",
      fallbackVersion: "1.0.0",
      id: "pier.ssh",
      prodPluginDirName: "pier.ssh",
    },
    {
      devPackageDir: "packages/plugin-claude",
      fallbackId: "pier.claude",
      fallbackName: "Claude",
      fallbackVersion: "1.0.0",
      id: "pier.claude",
      prodPluginDirName: "pier.claude",
    },
  ];

export function toBundledPluginRegistration(
  id: string,
  bundle: BundledPluginBundle
): BundledPluginRegistration {
  return {
    archivePath: bundle.archivePath,
    contributionCounts: bundle.contributionCounts,
    displayName: bundle.name,
    id,
    sha256: bundle.sha256,
    version: bundle.version,
    ...(bundle.description === undefined
      ? {}
      : { description: bundle.description }),
    ...(bundle.locales === undefined ? {} : { locales: bundle.locales }),
    ...(bundle.size === undefined ? {} : { size: bundle.size }),
  };
}

export function collectBundledPluginRegistrations(
  specs: readonly OfficialBundledPluginSpec[] = OFFICIAL_BUNDLED_PLUGIN_SPECS,
  readBundle: typeof readBundledPlugin = readBundledPlugin
): {
  availableById: ReadonlyMap<string, boolean>;
  registrations: BundledPluginRegistration[];
} {
  const registrations: BundledPluginRegistration[] = [];
  const availableById = new Map<string, boolean>();
  for (const spec of specs) {
    const bundle = readBundle({
      devPackageDir: spec.devPackageDir,
      fallbackId: spec.fallbackId,
      fallbackName: spec.fallbackName,
      fallbackVersion: spec.fallbackVersion,
      prodPluginDirName: spec.prodPluginDirName,
    });
    availableById.set(spec.id, bundle !== null);
    if (bundle) {
      registrations.push(toBundledPluginRegistration(spec.id, bundle));
    }
  }
  return { availableById, registrations };
}
