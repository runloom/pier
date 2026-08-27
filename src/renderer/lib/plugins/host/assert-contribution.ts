import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";

export type PluginContributionKind =
  | "action"
  | "groupContent"
  | "panel"
  | "projectSettings"
  | "terminalStatusItem";

export type AssertDeclaredContribution = (
  entry: PluginRegistryEntry | undefined,
  kind: PluginContributionKind,
  id: string
) => void;

export function assertDeclaredContribution(
  entry: PluginRegistryEntry | undefined,
  kind: PluginContributionKind,
  id: string
): void {
  if (!entry) {
    return;
  }
  let declared: boolean;
  if (kind === "action") {
    declared = entry.manifest.commands.some((command) => command.id === id);
  } else if (kind === "panel") {
    declared = entry.manifest.panels.some((panel) => panel.id === id);
  } else if (kind === "groupContent") {
    declared = (entry.manifest.groupContent ?? []).some(
      (contribution) => contribution.id === id
    );
  } else if (kind === "projectSettings") {
    declared = (entry.manifest.projectSettings ?? []).some(
      (page) => page.id === id
    );
  } else {
    declared = entry.manifest.terminalStatusItems.some(
      (item) => item.id === id
    );
  }
  if (!declared) {
    throw new Error(
      `plugin contribution not declared: ${entry.manifest.id}:${kind}:${id}`
    );
  }
}
