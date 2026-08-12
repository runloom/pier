import type { PluginRegistryDiagnostic } from "@shared/contracts/plugin.ts";
import type { RendererPluginRuntimeDiagnostic } from "@/lib/plugins/runtime-diagnostics.ts";

type DiagnosticKind = PluginRegistryDiagnostic["code"] | "runtime";

interface DiagnosticGroup {
  detail: string | null;
  key: string;
  kind: DiagnosticKind;
}

function diagnosticSourceLabel(
  source: PluginRegistryDiagnostic["source"]
): string | null {
  if (typeof source.path === "string" && source.path.length > 0) {
    return source.path;
  }
  if (typeof source.url === "string" && source.url.length > 0) {
    return source.url;
  }
  return null;
}

/** User-facing detail line: location (when known) + technical message. */
export function formatPluginDiagnosticDetail(
  diagnostic: PluginRegistryDiagnostic
): string {
  const location = diagnosticSourceLabel(diagnostic.source);
  if (location && location !== diagnostic.message) {
    return `${location}\n${diagnostic.message}`;
  }
  return diagnostic.message;
}

export function groupPluginDiagnostics(
  diagnostics: readonly PluginRegistryDiagnostic[],
  runtimeDiagnostics: readonly RendererPluginRuntimeDiagnostic[]
): DiagnosticGroup[] {
  const groups = new Map<string, DiagnosticGroup>();
  for (const diagnostic of diagnostics) {
    const location = diagnosticSourceLabel(diagnostic.source) ?? "";
    // Keep one row per source + message so distinct plugins do not collapse.
    const key = `${diagnostic.code}:${diagnostic.source.kind}:${location}:${diagnostic.message}`;
    if (groups.has(key)) continue;
    groups.set(key, {
      detail: formatPluginDiagnosticDetail(diagnostic),
      key,
      kind: diagnostic.code,
    });
  }
  for (const diagnostic of runtimeDiagnostics) {
    const key = `runtime:${diagnostic.pluginId}:${diagnostic.message}`;
    if (groups.has(key)) continue;
    const detail = diagnostic.pluginId
      ? `${diagnostic.pluginId}\n${diagnostic.message}`
      : diagnostic.message;
    groups.set(key, {
      detail,
      key,
      kind: "runtime",
    });
  }
  return [...groups.values()];
}
