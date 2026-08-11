import type {
  LspProviderDescriptor,
  LspServerProvider,
} from "@shared/contracts/lsp-provider.ts";
import {
  launchSpecForResolvedBinary,
  resolveCommandOnPath,
} from "../resolve-command.ts";
import {
  basenameOfPath,
  extensionOfPath,
  matchBasenameMatchers,
  matchPathExtensions,
  normalizeFsRoot,
  resolveRootByMarkers,
} from "../resolve-root.ts";

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
  const attempts = launchAttemptsForDescriptor(descriptor);

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
      for (const attempt of attempts) {
        const binary = resolveCommandOnPath(attempt.command);
        if (!binary) {
          continue;
        }
        const launch = launchSpecForResolvedBinary(binary, attempt.args);
        if (!launch) {
          continue;
        }
        return {
          args: launch.args,
          command: launch.command,
          cwd: normalizeFsRoot(rootPath),
        };
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
