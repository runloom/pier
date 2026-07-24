import type { StatusStackItem } from "@pier/ui/status-stack.tsx";
import type { PluginRegistryDiagnostic } from "@shared/contracts/plugin.ts";
import type { RendererPluginRuntimeDiagnostic } from "@/lib/plugins/plugin-runtime-diagnostics.ts";
import { groupPluginDiagnostics } from "./plugin-diagnostics-summary.tsx";

type DiagnosticKind = PluginRegistryDiagnostic["code"] | "runtime";

export function pluginDiagnosticKindLabel(
  kind: DiagnosticKind,
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  if (kind === "invalid_manifest") {
    return t("settings.plugins.diagnostics.invalidManifest");
  }
  if (kind === "unsupported") {
    return t("settings.plugins.diagnostics.unsupported");
  }
  return t("settings.plugins.diagnostics.runtime");
}

export function buildPluginStatusItems(input: {
  pageError: string | null;
  catalogError: string | null;
  diagnostics: readonly PluginRegistryDiagnostic[];
  runtimeDiagnostics: readonly RendererPluginRuntimeDiagnostic[];
  pluginMode: "workspace" | "release" | null | undefined;
  t: (key: string, opts?: Record<string, unknown>) => string;
}): StatusStackItem[] {
  const {
    pageError,
    catalogError,
    diagnostics,
    runtimeDiagnostics,
    pluginMode,
    t,
  } = input;
  const items: StatusStackItem[] = [];

  const errorLines = [pageError, catalogError].filter(
    (value): value is string => typeof value === "string" && value.length > 0
  );
  if (errorLines.length > 0) {
    items.push({
      id: "plugins-error",
      tone: "destructive",
      title: t("settings.plugins.errorTitle"),
      description: errorLines.join("\n"),
    });
  }

  const groups = groupPluginDiagnostics(diagnostics, runtimeDiagnostics);
  if (groups.length === 1) {
    const group = groups[0]!;
    items.push({
      id: "plugins-diagnostics",
      tone: "warning",
      title: pluginDiagnosticKindLabel(group.kind, t),
      ...(group.detail ? { description: group.detail } : {}),
    });
  } else if (groups.length >= 2) {
    items.push({
      id: "plugins-diagnostics",
      tone: "warning",
      title: t("settings.plugins.diagnostics.summaryTitle"),
      description: groups
        .map((group) => {
          const label = pluginDiagnosticKindLabel(group.kind, t);
          return group.detail ? `${label}: ${group.detail}` : label;
        })
        .join("\n"),
    });
  }

  if (pluginMode === "workspace") {
    items.push({
      id: "plugins-workspace",
      tone: "info",
      title: t("settings.plugins.pluginMode.workspaceTitle"),
      description: t("settings.plugins.pluginMode.workspaceBody"),
    });
  }

  return items;
}
