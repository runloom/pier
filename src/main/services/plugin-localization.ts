import { isAbsolute, join, normalize, relative, sep } from "node:path";
import type {
  PluginLocaleMessages,
  PluginManifest,
  PluginRegistryDiagnostic,
  PluginRegistryDiagnosticSource,
} from "@shared/contracts/plugin.ts";
import { pluginLocaleMessagesSchema } from "@shared/contracts/plugin.ts";

type PluginLocaleSource =
  | { baseDir?: string; kind: "builtin" }
  | { kind: "local"; path: string }
  | { kind: "git" | "registry" };

function invalidLocaleDiagnostic(
  source: PluginRegistryDiagnosticSource
): PluginRegistryDiagnostic {
  return {
    code: "invalid_manifest",
    message: "invalid plugin locale",
    source,
  };
}

function parseLocaleMessages(raw: unknown): PluginLocaleMessages {
  const parsed = pluginLocaleMessagesSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("invalid plugin locale");
  }
  return parsed.data;
}

function mergeContributionMessages(
  base: PluginLocaleMessages["commands"],
  overlay: PluginLocaleMessages["commands"]
): PluginLocaleMessages["commands"] {
  if (!(base || overlay)) {
    return;
  }
  return { ...(base ?? {}), ...(overlay ?? {}) };
}

function mergeUiMessages(
  base: PluginLocaleMessages["messages"],
  overlay: PluginLocaleMessages["messages"]
): PluginLocaleMessages["messages"] {
  if (!(base || overlay)) {
    return;
  }
  return { ...(base ?? {}), ...(overlay ?? {}) };
}

function mergeLocaleMessages(
  base: PluginLocaleMessages | undefined,
  overlay: PluginLocaleMessages
): PluginLocaleMessages {
  const commands = mergeContributionMessages(base?.commands, overlay.commands);
  const messages = mergeUiMessages(base?.messages, overlay.messages);
  const panels = mergeContributionMessages(base?.panels, overlay.panels);
  const terminalStatusItems = mergeContributionMessages(
    base?.terminalStatusItems,
    overlay.terminalStatusItems
  );
  return {
    ...(base ?? {}),
    ...overlay,
    ...(commands ? { commands } : {}),
    ...(messages ? { messages } : {}),
    ...(panels ? { panels } : {}),
    ...(terminalStatusItems ? { terminalStatusItems } : {}),
  };
}

function mergeManifestLocale(
  manifest: PluginManifest,
  locale: string,
  messages: PluginLocaleMessages
): PluginManifest {
  return {
    ...manifest,
    locales: {
      ...(manifest.locales ?? {}),
      [locale]: mergeLocaleMessages(manifest.locales?.[locale], messages),
    },
  };
}

function mergeManifestLocales(
  manifest: PluginManifest,
  locales: Record<string, PluginLocaleMessages>
): PluginManifest {
  return Object.entries(locales).reduce(
    (nextManifest, [locale, messages]) =>
      mergeManifestLocale(nextManifest, locale, messages),
    manifest
  );
}

function isPathInside(baseDir: string, targetPath: string): boolean {
  const rel = relative(baseDir, targetPath);
  return (
    rel === "" ||
    !(rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
  );
}

function resolveLocaleFilePath(baseDir: string, filePath: string): string {
  if (isAbsolute(filePath)) {
    throw new Error("invalid plugin locale");
  }
  const resolved = join(baseDir, normalize(filePath));
  if (!isPathInside(baseDir, resolved)) {
    throw new Error("invalid plugin locale");
  }
  return resolved;
}

export async function loadManifestLocaleFiles({
  baseDir,
  manifest,
  readTextFile,
  source,
  staticLocales = {},
}: {
  baseDir: string | null;
  manifest: PluginManifest;
  readTextFile: (path: string) => Promise<string>;
  source: PluginLocaleSource;
  staticLocales?: Record<string, PluginLocaleMessages>;
}): Promise<{
  diagnostics: PluginRegistryDiagnostic[];
  manifest: PluginManifest;
}> {
  const files = manifest.localization?.files ?? {};
  const entries = Object.entries(files).filter(
    ([locale]) => !staticLocales[locale]
  );
  const manifestWithStaticLocales = mergeManifestLocales(
    manifest,
    staticLocales
  );
  if (entries.length === 0) {
    return { diagnostics: [], manifest: manifestWithStaticLocales };
  }

  if (!baseDir) {
    return {
      diagnostics: entries.map(([_, filePath]) =>
        invalidLocaleDiagnostic({ kind: source.kind, path: filePath })
      ),
      manifest: manifestWithStaticLocales,
    };
  }

  let nextManifest = manifestWithStaticLocales;
  const diagnostics: PluginRegistryDiagnostic[] = [];
  for (const [locale, filePath] of entries) {
    let resolvedPath = join(baseDir, filePath);
    try {
      resolvedPath = resolveLocaleFilePath(baseDir, filePath);
      const messages = parseLocaleMessages(
        JSON.parse(await readTextFile(resolvedPath))
      );
      nextManifest = mergeManifestLocale(nextManifest, locale, messages);
    } catch {
      diagnostics.push(
        invalidLocaleDiagnostic({
          kind: source.kind,
          path: resolvedPath,
        })
      );
    }
  }

  return { diagnostics, manifest: nextManifest };
}
