import type {
  LspCatalogEntry,
  LspProviderDescriptor,
} from "@shared/contracts/lsp-provider.ts";
import { PATH_LANGUAGE_MATRIX } from "./path-rows.ts";
import type { LanguageMatrixRow, PathLspDescriptor } from "./types.ts";

function normalizeExt(ext: string): string {
  const withDot = ext.startsWith(".") ? ext : `.${ext}`;
  return withDot.toLowerCase();
}

/** PATH provider descriptors derived from the matrix (source always core). */
export function pathLspDescriptorsFromMatrix(
  rows: readonly LanguageMatrixRow[] = PATH_LANGUAGE_MATRIX
): PathLspDescriptor[] {
  const out: PathLspDescriptor[] = [];
  for (const row of rows) {
    const lsp = row.lsp;
    if (!lsp) continue;
    const extensions = (lsp.extensions ?? row.extensions).map(normalizeExt);
    const descriptor: PathLspDescriptor = {
      args: lsp.args ? [...lsp.args] : [],
      binaryHint: lsp.binaryHint,
      command: lsp.command,
      displayName: lsp.displayName,
      extensions,
      id: lsp.id,
      languageIds: [...lsp.languageIds],
      priority: lsp.priority,
      rootMarkers: [...lsp.rootMarkers],
      source: "core",
      ...(lsp.commandCandidates
        ? { commandCandidates: [...lsp.commandCandidates] }
        : {}),
      ...(lsp.installCommand ? { installCommand: lsp.installCommand } : {}),
      ...(lsp.injectTypescriptSdk ? { injectTypescriptSdk: true } : {}),
      ...(lsp.languageIdByExtension
        ? { languageIdByExtension: { ...lsp.languageIdByExtension } }
        : {}),
      ...(lsp.launchCandidates
        ? {
            launchCandidates: lsp.launchCandidates.map((c) => ({
              command: c.command,
              args: c.args ? [...c.args] : [],
            })),
          }
        : {}),
      ...(lsp.workspaceRelativeCommands
        ? {
            workspaceRelativeCommands: lsp.workspaceRelativeCommands.map(
              (c) => ({
                command: c.command,
                args: c.args ? [...c.args] : [],
              })
            ),
          }
        : {}),
      ...(lsp.preferLaunchCommandsWhenMarkers
        ? {
            preferLaunchCommandsWhenMarkers: {
              commands: [...lsp.preferLaunchCommandsWhenMarkers.commands],
              markers: [...lsp.preferLaunchCommandsWhenMarkers.markers],
            },
          }
        : {}),
      ...(row.basenameMatchers
        ? { basenameMatchers: [...row.basenameMatchers] }
        : {}),
    };
    out.push(descriptor);
  }
  return out;
}

/** Static catalog rows for PATH languages (probe fills status). */
export function pathCatalogFromMatrix(
  rows: readonly LanguageMatrixRow[] = PATH_LANGUAGE_MATRIX
): LspCatalogEntry[] {
  return pathLspDescriptorsFromMatrix(rows).map((d) => ({
    binaryHint: d.binaryHint,
    displayName: d.displayName,
    extensions: [...d.extensions],
    id: d.id,
    source: "core" as const,
    ...(d.installCommand ? { installCommand: d.installCommand } : {}),
  }));
}

/**
 * Extension (no leading dot, lowercase) → editor language id.
 * First row wins on conflict (matrix order).
 */
export function editorExtensionMapFromMatrix(
  rows: readonly LanguageMatrixRow[] = PATH_LANGUAGE_MATRIX
): Readonly<Record<string, string>> {
  const map: Record<string, string> = {};
  for (const row of rows) {
    if (!row.editorLanguageId) continue;
    for (const ext of row.extensions) {
      const key = normalizeExt(ext).slice(1);
      if (key.length > 0 && map[key] === undefined) {
        map[key] = row.editorLanguageId;
      }
    }
  }
  return map;
}

/** Basename matchers that map to an editor language (e.g. Dockerfile). */
export function editorBasenameRulesFromMatrix(
  rows: readonly LanguageMatrixRow[] = PATH_LANGUAGE_MATRIX
): readonly { editorLanguageId: string; matchers: readonly string[] }[] {
  const rules: { editorLanguageId: string; matchers: readonly string[] }[] = [];
  for (const row of rows) {
    if (!(row.editorLanguageId && row.basenameMatchers?.length)) continue;
    rules.push({
      editorLanguageId: row.editorLanguageId,
      matchers: row.basenameMatchers,
    });
  }
  return rules;
}

export function asLspProviderDescriptor(
  entry: PathLspDescriptor
): LspProviderDescriptor {
  const { binaryHint: _hint, ...rest } = entry;
  return rest;
}
