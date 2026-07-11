import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@pier/ui/alert.tsx";
import { Badge } from "@pier/ui/badge.tsx";
import { Separator } from "@pier/ui/separator.tsx";
import type { PluginRegistryDiagnostic } from "@shared/contracts/plugin.ts";
import type { TFunction } from "i18next";
import { TriangleAlert } from "lucide-react";
import { Fragment, type JSX } from "react";
import type { RendererPluginRuntimeDiagnostic } from "@/lib/plugins/plugin-runtime-diagnostics.ts";

type DiagnosticKind = PluginRegistryDiagnostic["code"] | "runtime";

interface DiagnosticGroup {
  count: number;
  detail: string | null;
  key: string;
  kind: DiagnosticKind;
  sources: string[];
}

function registrySource(diagnostic: PluginRegistryDiagnostic): string {
  return diagnostic.source.kind;
}

export function groupPluginDiagnostics(
  diagnostics: readonly PluginRegistryDiagnostic[],
  runtimeDiagnostics: readonly RendererPluginRuntimeDiagnostic[]
): DiagnosticGroup[] {
  const groups = new Map<string, DiagnosticGroup>();
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.code}:${diagnostic.message}`;
    const previous = groups.get(key);
    const source = registrySource(diagnostic);
    if (previous) {
      previous.count += 1;
      if (!previous.sources.includes(source)) previous.sources.push(source);
    } else {
      groups.set(key, {
        count: 1,
        detail:
          diagnostic.message === "invalid plugin manifest"
            ? null
            : diagnostic.message,
        key,
        kind: diagnostic.code,
        sources: [source],
      });
    }
  }
  for (const diagnostic of runtimeDiagnostics) {
    const key = `runtime:${diagnostic.message}`;
    const previous = groups.get(key);
    if (previous) {
      previous.count += 1;
      if (!previous.sources.includes(diagnostic.pluginId)) {
        previous.sources.push(diagnostic.pluginId);
      }
    } else {
      groups.set(key, {
        count: 1,
        detail: diagnostic.message,
        key,
        kind: "runtime",
        sources: [diagnostic.pluginId],
      });
    }
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

function sourceLabel(source: string, t: TFunction): string {
  if (
    source === "builtin" ||
    source === "devOverride" ||
    source === "git" ||
    source === "local" ||
    source === "official" ||
    source === "registry"
  ) {
    return t(`settings.plugins.source.${source}`);
  }
  return source;
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
  const issueCount = diagnostics.length + runtimeDiagnostics.length;
  return (
    <Alert
      aria-label={t("settings.plugins.diagnosticsTitle")}
      data-testid="plugin-diagnostics-summary"
    >
      <TriangleAlert />
      <AlertTitle>
        {t("settings.plugins.diagnostics.summary", { count: groups.length })}
      </AlertTitle>
      <AlertAction>
        <Badge className="tabular-nums" variant="outline">
          {t("settings.plugins.diagnostics.occurrences", { count: issueCount })}
        </Badge>
      </AlertAction>
      <AlertDescription className="flex flex-col gap-2 pt-2">
        {groups.map((group, index) => (
          <Fragment key={group.key}>
            {index > 0 ? <Separator /> : null}
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-3">
                <strong className="font-medium text-foreground">
                  {kindLabel(group.kind, t)}
                </strong>
                <div className="flex shrink-0 flex-wrap justify-end gap-1">
                  {group.sources.map((source) => (
                    <Badge key={source} variant="secondary">
                      {sourceLabel(source, t)}
                    </Badge>
                  ))}
                </div>
              </div>
              {group.detail ? (
                <p className="truncate text-xs" title={group.detail}>
                  {group.detail}
                </p>
              ) : null}
            </div>
          </Fragment>
        ))}
      </AlertDescription>
    </Alert>
  );
}
