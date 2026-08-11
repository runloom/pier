import type {
  LspProviderDescriptor,
  LspServerProvider,
} from "@shared/contracts/lsp-provider.ts";
import {
  launchSpecForResolvedBinary,
  resolveFirstCommandOnPath,
} from "../resolve-command.ts";
import {
  extensionOfPath,
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

/**
 * Build a PATH-discovered (or absolute-command) LspServerProvider from a
 * serializable descriptor. Shared by L0 config languages, L1 custom, L2 plugins.
 */
export function createPathLspProvider(
  descriptor: LspProviderDescriptor
): LspServerProvider {
  const extensions = descriptor.extensions.map((ext) => ext.toLowerCase());
  const idByExt = languageIdMap(descriptor);
  const candidates = descriptor.commandCandidates?.length
    ? descriptor.commandCandidates
    : [descriptor.command];
  const args = descriptor.args ?? [];

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
      if (!ext) {
        return null;
      }
      return idByExt[ext] ?? null;
    },
    matchPath(path) {
      return matchPathExtensions(path, extensions);
    },
    resolveLaunch({ rootPath }) {
      const binary = resolveFirstCommandOnPath(candidates);
      if (!binary) {
        return null;
      }
      const launch = launchSpecForResolvedBinary(binary, args);
      if (!launch) {
        return null;
      }
      return {
        args: launch.args,
        command: launch.command,
        cwd: normalizeFsRoot(rootPath),
      };
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
