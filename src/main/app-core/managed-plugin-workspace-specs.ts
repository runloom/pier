import { listConfiguredWorkspaceRoots } from "../services/managed-plugins/mode.ts";
import { OFFICIAL_BUNDLED_PLUGIN_SPECS } from "./bundled-official-plugins.ts";

export interface WorkspaceDevPluginSpec {
  devPackageDir: string;
  id: string;
}

/** First-party bundled specs plus `.pier-dev` roots; custom ids override. */
export function resolveWorkspaceDevPluginSpecs(
  cwd: string
): WorkspaceDevPluginSpec[] {
  const specs: WorkspaceDevPluginSpec[] = [
    ...OFFICIAL_BUNDLED_PLUGIN_SPECS.map((s) => ({
      devPackageDir: s.devPackageDir,
      id: s.id,
    })),
    ...listConfiguredWorkspaceRoots(cwd).map((r) => ({
      devPackageDir: r.path,
      id: r.id,
    })),
  ];
  const byId = new Map<string, WorkspaceDevPluginSpec>();
  for (const spec of specs) {
    byId.set(spec.id, spec);
  }
  return [...byId.values()];
}
