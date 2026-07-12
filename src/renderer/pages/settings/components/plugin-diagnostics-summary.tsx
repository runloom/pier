import { Alert, AlertDescription, AlertTitle } from "@pier/ui/alert.tsx";
import type { PluginRegistryDiagnostic } from "@shared/contracts/plugin.ts";
import type { TFunction } from "i18next";
import { TriangleAlert } from "lucide-react";
import type { JSX } from "react";
import type { RendererPluginRuntimeDiagnostic } from "@/lib/plugins/plugin-runtime-diagnostics.ts";

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

function kindLabel(kind: DiagnosticKind, t: TFunction): string {
  if (kind === "invalid_manifest") {
    return t("settings.plugins.diagnostics.invalidManifest");
  }
  if (kind === "unsupported") {
    return t("settings.plugins.diagnostics.unsupported");
  }
  return t("settings.plugins.diagnostics.runtime");
}

export function PluginDiagnosticsSummary({
  diagnostics,
  runtimeDiagnostics,
  t,
}: {
  diagnostics: readonly PluginRegistryDiagnostic[];
  runtimeDiagnostics: readonly RendererPluginRuntimeDiagnostic[];
  t: TFunction;
}): JSX.Element | null {
  const groups = groupPluginDiagnostics(diagnostics, runtimeDiagnostics);
  if (groups.length === 0) return null;
  return (
    <div
      className="flex flex-col gap-2"
      data-testid="plugin-diagnostics-summary"
    >
      {groups.map((group) => (
        <Alert key={group.key}>
          <TriangleAlert />
          <AlertTitle>{kindLabel(group.kind, t)}</AlertTitle>
          {group.detail ? (
            <AlertDescription>{group.detail}</AlertDescription>
          ) : null}
        </Alert>
      ))}
    </div>
  );
}
