import { Badge } from "@pier/ui/badge.tsx";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { useT } from "@/i18n/use-t.ts";
import {
  resolvePluginCommandDisplay,
  resolvePluginPanelDisplay,
  resolvePluginTerminalStatusItemDisplay,
} from "@/lib/plugins/display.ts";

export interface ContributionBadge {
  id: string;
  title: string;
}

export function commandContributionBadges(
  entry: PluginRegistryEntry,
  locale: string
): ContributionBadge[] {
  return entry.manifest.commands.map((command) => ({
    id: command.id,
    title: resolvePluginCommandDisplay(entry.manifest, command, locale).title,
  }));
}

export function panelContributionBadges(
  entry: PluginRegistryEntry,
  locale: string
): ContributionBadge[] {
  return entry.manifest.panels.map((panel) => ({
    id: panel.id,
    title: resolvePluginPanelDisplay(entry.manifest, panel, locale).title,
  }));
}

export function terminalStatusContributionBadges(
  entry: PluginRegistryEntry,
  locale: string
): ContributionBadge[] {
  return entry.manifest.terminalStatusItems.map((item) => ({
    id: item.id,
    title: resolvePluginTerminalStatusItemDisplay(entry.manifest, item, locale)
      .title,
  }));
}

function ContributionBadgeList({
  emptyLabel,
  items,
}: {
  emptyLabel: string;
  items: ContributionBadge[];
}) {
  if (items.length === 0) {
    return <span className="text-muted-foreground">{emptyLabel}</span>;
  }

  return (
    <>
      {items.map((item) => (
        <Badge
          className="max-w-full gap-1"
          key={item.id}
          title={item.id}
          variant="outline"
        >
          <span className="truncate">{item.title}</span>
          <span className="truncate text-muted-foreground/70">{item.id}</span>
        </Badge>
      ))}
    </>
  );
}

function countLabel(
  count: number,
  singularKey: string,
  pluralKey: string,
  t: ReturnType<typeof useT>
): string | null {
  if (count === 0) {
    return null;
  }
  return t(count === 1 ? singularKey : pluralKey, { count });
}

export function contributionSummary(
  entry: PluginRegistryEntry,
  t: ReturnType<typeof useT>
) {
  const parts = [
    countLabel(
      entry.manifest.commands.length,
      "settings.plugins.contributionSummary.command",
      "settings.plugins.contributionSummary.commands",
      t
    ),
    countLabel(
      entry.manifest.panels.length,
      "settings.plugins.contributionSummary.panel",
      "settings.plugins.contributionSummary.panels",
      t
    ),
    countLabel(
      entry.manifest.terminalStatusItems.length,
      "settings.plugins.contributionSummary.terminalStatusItem",
      "settings.plugins.contributionSummary.terminalStatusItems",
      t
    ),
  ].filter(Boolean);
  return parts.length > 0
    ? parts.join(" · ")
    : t("settings.plugins.contributionSummary.none");
}

function permissionLabel(
  permission: string,
  t: ReturnType<typeof useT>
): string {
  return t(`settings.plugins.permissionLabels.${permission}`, {
    defaultValue: permission,
    nsSeparator: false,
  });
}

function PluginMeta({ entry }: { entry: PluginRegistryEntry }) {
  const t = useT();
  const rows = [
    [t("settings.plugins.pluginId"), entry.manifest.id],
    [t("settings.plugins.version"), entry.manifest.version],
    [
      t("settings.plugins.publisher"),
      entry.manifest.publisher ?? t("settings.plugins.none"),
    ],
  ];

  return (
    <div className="grid gap-2 text-xs sm:grid-cols-3">
      {rows.map(([label, value]) => (
        <div className="min-w-0" key={label}>
          <div className="font-medium text-muted-foreground">{label}</div>
          <div className="truncate" title={value}>
            {value}
          </div>
        </div>
      ))}
    </div>
  );
}

function ContributionSection({
  emptyLabel,
  items,
  title,
}: {
  emptyLabel: string;
  items: ContributionBadge[];
  title: string;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-1 font-medium text-muted-foreground">{title}</div>
      <div className="flex flex-wrap gap-1">
        <ContributionBadgeList emptyLabel={emptyLabel} items={items} />
      </div>
    </div>
  );
}

export function PluginDetails({
  commandContributions,
  entry,
  panelContributions,
  terminalStatusContributions,
}: {
  commandContributions: ContributionBadge[];
  entry: PluginRegistryEntry;
  panelContributions: ContributionBadge[];
  terminalStatusContributions: ContributionBadge[];
}) {
  const t = useT();
  return (
    <div className="basis-full space-y-4 border-border/60 border-t pt-3 text-xs">
      <PluginMeta entry={entry} />
      <div className="grid gap-3 md:grid-cols-2">
        <ContributionSection
          emptyLabel={t("settings.plugins.none")}
          items={commandContributions}
          title={t("settings.plugins.commands")}
        />
        <ContributionSection
          emptyLabel={t("settings.plugins.none")}
          items={terminalStatusContributions}
          title={t("settings.plugins.terminalStatusItems")}
        />
        <ContributionSection
          emptyLabel={t("settings.plugins.none")}
          items={panelContributions}
          title={t("settings.plugins.panels")}
        />
        <div className="min-w-0">
          <div className="mb-1 font-medium text-muted-foreground">
            {t("settings.plugins.permissions")}
          </div>
          <div className="flex flex-wrap gap-1">
            {entry.effectivePermissions.length > 0 ? (
              entry.effectivePermissions.map((permission) => (
                <Badge key={permission} title={permission} variant="outline">
                  {permissionLabel(permission, t)}
                </Badge>
              ))
            ) : (
              <span className="text-muted-foreground">
                {t("settings.plugins.none")}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
