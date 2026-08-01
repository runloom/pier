import type { PluginRegistryDiagnostic } from "@shared/contracts/plugin.ts";
import type { RendererPluginRuntimeDiagnostic } from "@/lib/plugins/runtime-diagnostics.ts";

type DiagnosticKind = PluginRegistryDiagnostic["code"] | "runtime";

interface DiagnosticGroup {
  detail: string | null;
  key: string;
  kind: DiagnosticKind;
}

export function groupPluginDiagnostics(
  diagnostics: readonly PluginRegistryDiagnostic[],
  runtimeDiagnostics: readonly RendererPluginRuntimeDiagnostic[]
): DiagnosticGroup[] {
  const groups = new Map<string, DiagnosticGroup>();
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.code}:${diagnostic.message}`;
    if (groups.has(key)) continue;
    groups.set(key, {
      detail:
        diagnostic.message === "invalid plugin manifest"
          ? null
          : diagnostic.message,
      key,
      kind: diagnostic.code,
    });
  }
  for (const diagnostic of runtimeDiagnostics) {
    const key = `runtime:${diagnostic.message}`;
    if (groups.has(key)) continue;
    groups.set(key, {
      detail: diagnostic.message,
      key,
      kind: "runtime",
    });
  }
  return [...groups.values()];
}
