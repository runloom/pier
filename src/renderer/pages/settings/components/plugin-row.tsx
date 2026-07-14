import { Badge } from "@pier/ui/badge.tsx";
import { Button } from "@pier/ui/button.tsx";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@pier/ui/item.tsx";
import { Skeleton } from "@pier/ui/skeleton.tsx";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import i18next from "i18next";
import {
  Activity,
  ArrowRight,
  Command,
  LayoutDashboard,
  type LucideIcon,
  PanelsTopLeft,
  Puzzle,
} from "lucide-react";
import { useT } from "@/i18n/use-t.ts";
import { getBuiltinRendererPluginModule } from "@/lib/plugins/builtin-catalog.ts";
import { resolvePluginDisplay } from "@/lib/plugins/display.ts";
import { pluginSectionId } from "@/pages/settings/data/appearance-nav.ts";
import { useSettingsDialogStore } from "@/stores/settings-dialog.store.ts";

export interface ContributionCountItem {
  Icon: LucideIcon;
  id: string;
  label: string;
}

/** Contribution counts by kind. */
export interface ContributionCounts {
  readonly commands: number;
  readonly panels: number;
  readonly terminalStatusItems: number;
  readonly workbenchWidgets: number;
}

/** 只保留非零的贡献点计数, 每项配一个 lucide 图标。 */
export function contributionCountItemsFromCounts(
  counts: ContributionCounts,
  t: ReturnType<typeof useT>
): ContributionCountItem[] {
  const buckets: {
    Icon: LucideIcon;
    count: number;
    id: string;
    pluralKey: string;
    singularKey: string;
  }[] = [
    {
      Icon: Command,
      count: counts.commands,
      id: "commands",
      pluralKey: "settings.plugins.contributionSummary.commands",
      singularKey: "settings.plugins.contributionSummary.command",
    },
    {
      Icon: PanelsTopLeft,
      count: counts.panels,
      id: "panels",
      pluralKey: "settings.plugins.contributionSummary.panels",
      singularKey: "settings.plugins.contributionSummary.panel",
    },
    {
      Icon: Activity,
      count: counts.terminalStatusItems,
      id: "terminalStatusItems",
      pluralKey: "settings.plugins.contributionSummary.terminalStatusItems",
      singularKey: "settings.plugins.contributionSummary.terminalStatusItem",
    },
    {
      Icon: LayoutDashboard,
      count: counts.workbenchWidgets,
      id: "workbenchWidgets",
      pluralKey: "settings.plugins.contributionSummary.workbenchWidgets",
      singularKey: "settings.plugins.contributionSummary.workbenchWidget",
    },
  ];
  return buckets
    .filter((item) => item.count > 0)
    .map((item) => ({
      Icon: item.Icon,
      id: item.id,
      label: t(item.count === 1 ? item.singularKey : item.pluralKey, {
        count: item.count,
      }),
    }));
}

export function contributionCountItems(
  entry: PluginRegistryEntry,
  t: ReturnType<typeof useT>
): ContributionCountItem[] {
  return contributionCountItemsFromCounts(
    {
      commands: entry.manifest.commands.length,
      workbenchWidgets: entry.manifest.workbenchWidgets.length,
      panels: entry.manifest.panels.length,
      terminalStatusItems: entry.manifest.terminalStatusItems.length,
    },
    t
  );
}

/**
 * Full plugin row with source badge, contribution summary, settings link,
 * and enable/disable action. Shared between built-in and managed plugin lists.
 * `extraActions` renders adjacent to the enable/disable button (used by
 * managed plugins for Uninstall / Rollback / Update).
 */
export function PluginRow({
  entry,
  onToggle,
  pending,
  extraActions,
}: {
  entry: PluginRegistryEntry;
  onToggle(entry: PluginRegistryEntry): void;
  pending: boolean;
  extraActions?: React.ReactNode;
}) {
  const t = useT();
  const canToggle = entry.runtime.canToggle;
  const display = resolvePluginDisplay(entry, i18next.language);
  const RowIcon =
    getBuiltinRendererPluginModule(entry.manifest.id)?.icon ?? Puzzle;
  const actionKey = entry.enabled ? "disable" : "enable";
  const actionLabel = t(`settings.plugins.action.${actionKey}`);
  const actionAriaLabel = t(`settings.plugins.action.${actionKey}Plugin`, {
    name: display.name,
  });
  const statusLabel =
    entry.runtime.kind === "manifest-only"
      ? t("settings.plugins.status.manifestOnly")
      : t(
          `settings.plugins.status.${entry.runtime.enabled ? "enabled" : "disabled"}`
        );
  const metaText = `v${entry.manifest.version} · ${entry.manifest.publisher ?? "—"}`;
  const countItems = contributionCountItems(entry, t);
  const hasConfiguration =
    Boolean(entry.manifest.configuration) && entry.runtime.enabled;

  return (
    <Item
      className="rounded-none border-0 px-(--card-spacing)"
      data-testid={`plugin-row-${entry.manifest.id}`}
      role="listitem"
    >
      <ItemContent className="min-w-0 gap-1.5">
        <div className="flex w-full items-center justify-between gap-2">
          <ItemTitle className="min-w-0">
            <RowIcon
              aria-hidden
              className="size-4 shrink-0 text-muted-foreground"
            />
            <span className="truncate">{display.name}</span>
            <Badge variant={entry.runtime.enabled ? "secondary" : "outline"}>
              {statusLabel}
            </Badge>
          </ItemTitle>
          <span className="shrink-0 text-muted-foreground text-xs">
            {metaText}
          </span>
        </div>
        {display.description ? (
          <ItemDescription className="text-xs">
            {display.description}
          </ItemDescription>
        ) : null}
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
            {countItems.length > 0 ? (
              countItems.map(({ Icon, id, label }) => (
                <span className="inline-flex items-center gap-1" key={id}>
                  <Icon aria-hidden className="size-3.5" />
                  {label}
                </span>
              ))
            ) : (
              <span>{t("settings.plugins.contributionSummary.none")}</span>
            )}
            {hasConfiguration ? (
              <Button
                aria-label={t("settings.plugins.openSettingsPlugin", {
                  name: display.name,
                })}
                data-testid={`plugin-settings-link-${entry.manifest.id}`}
                onClick={() =>
                  useSettingsDialogStore
                    .getState()
                    .openSection(pluginSectionId(entry.manifest.id))
                }
                size="xs"
                type="button"
                variant="link"
              >
                {t("settings.plugins.openSettings")}
                <ArrowRight data-icon="inline-end" />
              </Button>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {extraActions}
            {canToggle ? (
              <Button
                aria-label={actionAriaLabel}
                disabled={pending}
                onClick={() => onToggle(entry)}
                size="sm"
                type="button"
                variant={entry.enabled ? "outline" : "default"}
              >
                {actionLabel}
              </Button>
            ) : null}
          </div>
        </div>
      </ItemContent>
    </Item>
  );
}

/** Loading skeleton for the plugins list. */
export function PluginsLoadingState() {
  const t = useT();
  return (
    <div
      className="flex flex-col gap-3 px-(--card-spacing) py-3"
      data-testid="plugins-loading"
    >
      <div className="flex flex-col gap-1.5">
        <div className="font-medium text-sm">
          {t("settings.plugins.loadingTitle")}
        </div>
        <div className="text-muted-foreground text-sm">
          {t("settings.plugins.loadingDescription")}
        </div>
      </div>
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-20 w-full" />
    </div>
  );
}
