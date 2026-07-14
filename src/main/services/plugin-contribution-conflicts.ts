import type { PluginManifest } from "@shared/contracts/plugin.ts";
import {
  CORE_RESERVED_ACTION_IDS,
  CORE_RESERVED_PANEL_IDS,
  CORE_RESERVED_TERMINAL_STATUS_ITEM_IDS,
  CORE_RESERVED_WORKBENCH_WIDGET_IDS,
} from "@shared/plugin-core-contribution-ids.ts";

function includesId(ids: readonly string[], id: string): boolean {
  return ids.includes(id);
}

export function findPluginIdDotPrefixConflict(
  acceptedIds: readonly string[],
  candidateId: string
): string | null {
  for (const id of acceptedIds) {
    if (
      id === candidateId ||
      id.startsWith(`${candidateId}.`) ||
      candidateId.startsWith(`${id}.`)
    ) {
      return id;
    }
  }
  return null;
}

function findContributionIdConflict<T>(
  acceptedManifests: readonly PluginManifest[],
  candidate: PluginManifest,
  select: (manifest: PluginManifest) => readonly T[],
  id: (item: T) => string
): string | null {
  const seen = new Set(
    acceptedManifests.flatMap((manifest) =>
      select(manifest).map((item) => id(item))
    )
  );
  for (const item of select(candidate)) {
    const itemId = id(item);
    if (seen.has(itemId)) return itemId;
    seen.add(itemId);
  }
  return null;
}

export function findCommandIdConflict(
  acceptedManifests: readonly PluginManifest[],
  candidate: PluginManifest
): string | null {
  const conflict = findContributionIdConflict(
    acceptedManifests,
    candidate,
    (manifest) => manifest.commands,
    (command) => command.id
  );
  if (conflict) return conflict;
  return (
    candidate.commands.find((command) =>
      includesId(CORE_RESERVED_ACTION_IDS, command.id)
    )?.id ?? null
  );
}

export function findWorkbenchWidgetIdConflict(
  acceptedManifests: readonly PluginManifest[],
  candidate: PluginManifest
): string | null {
  const conflict = findContributionIdConflict(
    acceptedManifests,
    candidate,
    (manifest) => manifest.workbenchWidgets,
    (widget) => widget.id
  );
  if (conflict) return conflict;
  return (
    candidate.workbenchWidgets.find((widget) =>
      includesId(CORE_RESERVED_WORKBENCH_WIDGET_IDS, widget.id)
    )?.id ?? null
  );
}

export function findPanelIdConflict(
  acceptedManifests: readonly PluginManifest[],
  candidate: PluginManifest
): string | null {
  const conflict = findContributionIdConflict(
    acceptedManifests,
    candidate,
    (manifest) => manifest.panels,
    (panel) => panel.id
  );
  if (conflict) return conflict;
  return (
    candidate.panels.find((panel) =>
      includesId(CORE_RESERVED_PANEL_IDS, panel.id)
    )?.id ?? null
  );
}

export function findTerminalStatusItemIdConflict(
  acceptedManifests: readonly PluginManifest[],
  candidate: PluginManifest
): string | null {
  const conflict = findContributionIdConflict(
    acceptedManifests,
    candidate,
    (manifest) => manifest.terminalStatusItems,
    (item) => item.id
  );
  if (conflict) return conflict;
  return (
    candidate.terminalStatusItems.find((item) =>
      includesId(CORE_RESERVED_TERMINAL_STATUS_ITEM_IDS, item.id)
    )?.id ?? null
  );
}
