import type { ManagedPluginCatalogSnapshot } from "@shared/contracts/plugin/managed.ts";
import { rejectFailedManagedPluginOperation } from "./managed-plugin-operation.ts";

export interface UpdatableManagedPlugin {
  id: string;
  name: string;
  version: string;
}

export interface ManagedPluginUpdateAllSuccess {
  id: string;
  name: string;
}

export interface ManagedPluginUpdateAllFailure {
  id: string;
  message: string;
  name: string;
}

export interface ManagedPluginUpdateAllResult {
  failures: ManagedPluginUpdateAllFailure[];
  successes: ManagedPluginUpdateAllSuccess[];
}

/** Stable order: localeCompare on id (en). */
export function listUpdatableManagedPlugins(
  catalog: ManagedPluginCatalogSnapshot | null | undefined,
  officialMutationsAllowed: boolean
): UpdatableManagedPlugin[] {
  if (!(catalog && officialMutationsAllowed)) {
    return [];
  }
  const out: UpdatableManagedPlugin[] = [];
  for (const plugin of catalog.plugins) {
    if (!(plugin.installed && plugin.update)) {
      continue;
    }
    out.push({
      id: plugin.id,
      name: plugin.displayName?.trim() || plugin.id,
      version: plugin.update.version,
    });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

/**
 * Serial updates. Does not refresh catalog or show UI.
 * `update` should already wrap IPC; this helper wraps each call with
 * rejectFailedManagedPluginOperation semantics (ok:false → throw).
 */
export async function runManagedPluginUpdateAll(input: {
  targets: readonly UpdatableManagedPlugin[];
  update: (id: string) => Promise<unknown>;
  onProgress?: (current: number, total: number) => void;
}): Promise<ManagedPluginUpdateAllResult> {
  const successes: ManagedPluginUpdateAllSuccess[] = [];
  const failures: ManagedPluginUpdateAllFailure[] = [];
  const total = input.targets.length;
  let current = 0;
  for (const target of input.targets) {
    current += 1;
    input.onProgress?.(current, total);
    try {
      await rejectFailedManagedPluginOperation(input.update(target.id));
      successes.push({ id: target.id, name: target.name });
    } catch (err) {
      failures.push({
        id: target.id,
        name: target.name,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { successes, failures };
}

/** Multiline body for showAppAlert. */
export function formatManagedPluginUpdateAllAlertBody(input: {
  successCount: number;
  failures: readonly ManagedPluginUpdateAllFailure[];
  successSummaryLabel: string;
}): string {
  const lines: string[] = [];
  if (input.successCount > 0 && input.successSummaryLabel.trim()) {
    lines.push(input.successSummaryLabel.trim());
  }
  for (const failure of input.failures) {
    lines.push(`${failure.name}: ${failure.message}`);
  }
  return lines.join("\n");
}
