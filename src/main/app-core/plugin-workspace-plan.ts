import type {
  PluginRegistryListResult,
  PluginWorkspacePlan,
  PluginWorkspacePlanEntry,
} from "@shared/contracts/plugin.ts";
import type { PierPluginMode } from "@shared/plugin-mode.ts";

/**
 * Workspace plan builder (打印即所装).
 *
 * Consumes the SAME `plugins.list()` result that feeds the main plugin runtime
 * (`runtime.refresh(result.entries)`), so the printed plan can never drift from
 * what actually mounts — the dsh `--dump-config == mounted` discipline. This
 * module is a projection only: it must not re-resolve sources or re-read state.
 */
export function buildPluginWorkspacePlan(
  listResult: PluginRegistryListResult,
  mode: PierPluginMode
): PluginWorkspacePlan {
  const entries: PluginWorkspacePlanEntry[] = listResult.entries.map(
    (entry) => ({
      enabled: entry.enabled,
      id: entry.manifest.id,
      permissions: entry.effectivePermissions,
      runtime: {
        canToggle: entry.runtime.canToggle,
        enabled: entry.runtime.enabled,
        kind: entry.runtime.kind,
      },
      source: entry.manifest.source,
      version: entry.manifest.version,
    })
  );
  return { diagnostics: listResult.diagnostics, entries, mode };
}
