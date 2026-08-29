import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  LspProviderDescriptor,
  LspServerLaunchSpec,
  LspServerProvider,
} from "@shared/contracts/lsp-provider.ts";
import {
  launchSpecForResolvedBinary,
  resolveCommandOnPath,
  resolveWorkspaceRelativeBinary,
} from "../resolve-command.ts";
import {
  basenameOfPath,
  extensionOfPath,
  matchBasenameMatchers,
  matchPathExtensions,
  normalizeFsRoot,
  resolveRootByMarkers,
} from "../resolve-root.ts";
import { resolveTypescriptSdkLibForVue } from "../resolve-typescript-sdk.ts";

function languageIdMap(
  descriptor: LspProviderDescriptor
): Readonly<Record<string, string>> {
  const map: Record<string, string> = {};
  if (descriptor.languageIdByExtension) {
    // Path lookup always lowercases extensions — normalize keys here.
    for (const [ext, languageId] of Object.entries(
      descriptor.languageIdByExtension
    )) {
      const key = ext.startsWith(".")
        ? ext.toLowerCase()
        : `.${ext.toLowerCase()}`;
      map[key] = languageId;
    }
    return map;
  }
  const primary = descriptor.languageIds[0];
  if (!primary) {
    return {};
  }
  for (const ext of descriptor.extensions) {
    map[ext.toLowerCase()] = primary;
  }
  return map;
}

interface LaunchAttempt {
  args: readonly string[];
  command: string;
}

function launchAttemptsForDescriptor(
  descriptor: LspProviderDescriptor
): LaunchAttempt[] {
  if (descriptor.launchCandidates && descriptor.launchCandidates.length > 0) {
    return descriptor.launchCandidates.map((entry) => ({
      args: entry.args ?? [],
      command: entry.command,
    }));
  }
  const candidates = descriptor.commandCandidates?.length
    ? descriptor.commandCandidates
    : [descriptor.command];
  const args = descriptor.args ?? [];
  return candidates.map((command) => ({ args, command }));
}

function rootHasAnyMarker(
  rootPath: string,
  markers: readonly string[]
): boolean {
  return markers.some((marker) => existsSync(join(rootPath, marker)));
}

function prioritizeLaunchAttempts(
  attempts: readonly LaunchAttempt[],
  preferredCommands: readonly string[]
): LaunchAttempt[] {
  const preferred = new Set(preferredCommands);
  return [
    ...attempts.filter((attempt) => preferred.has(attempt.command)),
    ...attempts.filter((attempt) => !preferred.has(attempt.command)),
  ];
}

function pathLaunchAttempts(
  descriptor: LspProviderDescriptor,
  rootPath: string
): LaunchAttempt[] {
  const attempts = launchAttemptsForDescriptor(descriptor);
  const preference = descriptor.preferLaunchCommandsWhenMarkers;
  if (!(preference && rootHasAnyMarker(rootPath, preference.markers))) {
    return attempts;
  }
  return prioritizeLaunchAttempts(attempts, preference.commands);
}

function launchFromBinary(
  binary: string,
  args: readonly string[],
  cwd: string
): LspServerLaunchSpec | null {
  const launch = launchSpecForResolvedBinary(binary, args);
  if (!launch) {
    return null;
  }
  return {
    args: launch.args,
    command: launch.command,
    cwd,
  };
}

function withTypescriptSdk(
  descriptor: LspProviderDescriptor,
  rootPath: string,
  spec: LspServerLaunchSpec
): LspServerLaunchSpec {
  if (!descriptor.injectTypescriptSdk) {
    return spec;
  }
  const tsdk = resolveTypescriptSdkLibForVue(rootPath);
  if (!tsdk) {
    return spec;
  }
  return {
    ...spec,
    initializationOptions: { typescript: { tsdk } },
  };
}

/**
 * Build a PATH-discovered (or absolute-command) LspServerProvider from a
 * serializable descriptor. Shared by L0 config languages, L1 custom, L2 plugins.
 */
export function createPathLspProvider(
  descriptor: LspProviderDescriptor
): LspServerProvider {
  const extensions = descriptor.extensions.map((ext) => ext.toLowerCase());
  const idByExt = languageIdMap(descriptor);
  const basenameMatchers = descriptor.basenameMatchers ?? [];
  const primaryLanguageId = descriptor.languageIds[0] ?? null;

  return {
    displayName: descriptor.displayName,
    id: descriptor.id,
    ...(descriptor.installCommand
      ? { installCommand: descriptor.installCommand }
      : {}),
    priority: descriptor.priority,
    rootMarkers: descriptor.rootMarkers,
    source: descriptor.source,
    selector: {
      extensions,
      languageIds: descriptor.languageIds,
    },
    languageIdForPath(path) {
      const ext = extensionOfPath(path);
      if (ext && idByExt[ext]) {
        return idByExt[ext] ?? null;
      }
      if (
        basenameMatchers.length > 0 &&
        matchBasenameMatchers(basenameOfPath(path), basenameMatchers)
      ) {
        return primaryLanguageId;
      }
      return null;
    },
    matchPath(path) {
      if (matchPathExtensions(path, extensions)) {
        return true;
      }
      if (basenameMatchers.length === 0) {
        return false;
      }
      return matchBasenameMatchers(basenameOfPath(path), basenameMatchers);
    },
    resolveLaunch({ rootPath }) {
      const cwd = normalizeFsRoot(rootPath);
      const relativeAttempts = descriptor.workspaceRelativeCommands ?? [];
      for (const attempt of relativeAttempts) {
        const binary = resolveWorkspaceRelativeBinary(
          rootPath,
          attempt.command
        );
        if (!binary) {
          continue;
        }
        const spec = launchFromBinary(binary, attempt.args ?? [], cwd);
        if (spec) {
          return withTypescriptSdk(descriptor, rootPath, spec);
        }
      }
      for (const attempt of pathLaunchAttempts(descriptor, rootPath)) {
        const binary = resolveCommandOnPath(attempt.command);
        if (!binary) {
          continue;
        }
        const spec = launchFromBinary(binary, attempt.args, cwd);
        if (spec) {
          return withTypescriptSdk(descriptor, rootPath, spec);
        }
      }
      return null;
    },
    resolveRoot(input) {
      return resolveRootByMarkers({
        fallbackWorkspaceRoot: input.fallbackWorkspaceRoot,
        filePath: input.filePath,
        markers: descriptor.rootMarkers,
      });
    },
  };
}
