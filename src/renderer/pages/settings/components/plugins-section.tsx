import type {
  PluginRegistryEntry,
  PluginRegistryListResult,
} from "@shared/contracts/plugin.ts";
import i18next from "i18next";
import { Fragment, useCallback, useEffect, useState } from "react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/primitives/alert.tsx";
import { Badge } from "@/components/primitives/badge.tsx";
import { Button } from "@/components/primitives/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/primitives/card.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/primitives/empty.tsx";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from "@/components/primitives/item.tsx";
import { Skeleton } from "@/components/primitives/skeleton.tsx";
import { useT } from "@/i18n/use-t.ts";
import { refreshBuiltinPlugins } from "@/lib/plugins/bootstrap.ts";
import {
  resolvePluginCommandDisplay,
  resolvePluginDisplay,
  resolvePluginPanelDisplay,
} from "@/lib/plugins/display.ts";

interface ContributionBadge {
  id: string;
  title: string;
}

function commandContributionBadges(
  entry: PluginRegistryEntry,
  locale: string
): ContributionBadge[] {
  return entry.commands.map((command) => ({
    id: command.id,
    title: resolvePluginCommandDisplay(entry.manifest, command, locale).title,
  }));
}

function panelContributionBadges(
  entry: PluginRegistryEntry,
  locale: string
): ContributionBadge[] {
  return entry.panels.map((panel) => ({
    id: panel.id,
    title: resolvePluginPanelDisplay(entry.manifest, panel, locale).title,
  }));
}

function BadgeList({
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

function PluginsLoadingState() {
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

function PluginsEmptyState() {
  const t = useT();
  return (
    <Empty className="mx-(--card-spacing) min-h-40 rounded-xl border">
      <EmptyHeader>
        <EmptyTitle>{t("settings.plugins.emptyTitle")}</EmptyTitle>
        <EmptyDescription>
          {t("settings.plugins.emptyDescription")}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function PluginRow({
  entry,
  onToggle,
  pending,
}: {
  entry: PluginRegistryEntry;
  onToggle(entry: PluginRegistryEntry): void;
  pending: boolean;
}) {
  const t = useT();
  const canToggle =
    entry.source.kind === "builtin" || entry.source.kind === "local";
  const commandContributions = commandContributionBadges(
    entry,
    i18next.language
  );
  const panelContributions = panelContributionBadges(entry, i18next.language);
  const display = resolvePluginDisplay(entry, i18next.language);
  const actionKey = entry.enabled ? "disable" : "enable";
  const actionLabel = t(`settings.plugins.action.${actionKey}`);
  const actionAriaLabel = t(`settings.plugins.action.${actionKey}Plugin`, {
    name: display.name,
  });
  const statusLabel = t(
    `settings.plugins.status.${entry.enabled ? "enabled" : "disabled"}`
  );
  const sourceLabel = t(`settings.plugins.source.${entry.source.kind}`);

  return (
    <Item
      className="rounded-none border-0 px-(--card-spacing)"
      data-testid={`plugin-row-${entry.id}`}
      role="listitem"
    >
      <ItemContent className="min-w-0">
        <ItemTitle className="max-w-full">
          <span className="truncate">{display.name}</span>
          <Badge variant={entry.enabled ? "secondary" : "outline"}>
            {statusLabel}
          </Badge>
          <Badge variant="outline">{sourceLabel}</Badge>
        </ItemTitle>
        <ItemDescription className="break-all text-xs">
          {entry.id}
        </ItemDescription>
        {display.description ? (
          <ItemDescription className="text-xs">
            {display.description}
          </ItemDescription>
        ) : null}
      </ItemContent>
      <ItemActions>
        <Button
          aria-label={actionAriaLabel}
          disabled={!canToggle || pending}
          onClick={() => onToggle(entry)}
          size="sm"
          type="button"
          variant={entry.enabled ? "outline" : "default"}
        >
          {actionLabel}
        </Button>
      </ItemActions>

      <div className="grid basis-full gap-3 text-xs md:grid-cols-3">
        <div className="min-w-0">
          <div className="mb-1 font-medium text-muted-foreground">
            {t("settings.plugins.permissions")}
          </div>
          <div className="flex flex-wrap gap-1">
            {entry.permissions.length > 0 ? (
              entry.permissions.map((permission) => (
                <Badge key={permission} variant="outline">
                  {permission}
                </Badge>
              ))
            ) : (
              <span className="text-muted-foreground">
                {t("settings.plugins.none")}
              </span>
            )}
          </div>
        </div>
        <div className="min-w-0 md:col-span-2">
          <div className="mb-1 font-medium text-muted-foreground">
            {t("settings.plugins.commands")}
          </div>
          <div className="flex flex-wrap gap-1">
            <BadgeList
              emptyLabel={t("settings.plugins.none")}
              items={commandContributions}
            />
          </div>
        </div>
        <div className="min-w-0 md:col-span-3">
          <div className="mb-1 font-medium text-muted-foreground">
            {t("settings.plugins.panels")}
          </div>
          <div className="flex flex-wrap gap-1">
            <BadgeList
              emptyLabel={t("settings.plugins.none")}
              items={panelContributions}
            />
          </div>
        </div>
      </div>
    </Item>
  );
}

function PluginsListContent({
  onToggle,
  pendingId,
  result,
}: {
  onToggle(entry: PluginRegistryEntry): void;
  pendingId: string | null;
  result: PluginRegistryListResult | null;
}) {
  if (!result) {
    return <PluginsLoadingState />;
  }

  if (result.entries.length === 0) {
    return <PluginsEmptyState />;
  }

  return (
    <ItemGroup className="gap-0">
      {result.entries.map((entry, index) => (
        <Fragment key={entry.id}>
          {index > 0 ? <ItemSeparator className="my-0" /> : null}
          <PluginRow
            entry={entry}
            onToggle={onToggle}
            pending={pendingId === entry.id}
          />
        </Fragment>
      ))}
    </ItemGroup>
  );
}

export function PluginsSection() {
  const t = useT();
  const [result, setResult] = useState<PluginRegistryListResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setResult(await window.pier.plugins.list());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  const togglePlugin = (entry: PluginRegistryEntry) => {
    setPendingId(entry.id);
    const request = entry.enabled
      ? window.pier.plugins.disable(entry.id)
      : window.pier.plugins.enable(entry.id);
    request
      .then(async () => {
        const nextResult = await window.pier.plugins.list();
        setResult(nextResult);
        await refreshBuiltinPlugins(nextResult.entries);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setPendingId(null);
      });
  };

  return (
    <div className="px-4 pb-4" id="plugins">
      <h1 className="mb-4 text-xl">{t("settings.section.plugins")}</h1>
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.plugins.title")}</CardTitle>
          <CardDescription>{t("settings.plugins.description")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 px-0">
          {error ? (
            <div className="px-(--card-spacing)">
              <Alert variant="destructive">
                <AlertTitle>{t("settings.plugins.errorTitle")}</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            </div>
          ) : null}
          {result?.diagnostics.length ? (
            <div className="px-(--card-spacing)">
              <Alert>
                <AlertTitle>
                  {t("settings.plugins.diagnosticsTitle")}
                </AlertTitle>
                <AlertDescription>
                  <div className="flex flex-col gap-1">
                    {result.diagnostics.map((diagnostic) => (
                      <div
                        key={`${diagnostic.source.kind}:${diagnostic.message}`}
                      >
                        {diagnostic.message}
                      </div>
                    ))}
                  </div>
                </AlertDescription>
              </Alert>
            </div>
          ) : null}
          <PluginsListContent
            onToggle={togglePlugin}
            pendingId={pendingId}
            result={result}
          />
        </CardContent>
      </Card>
    </div>
  );
}
