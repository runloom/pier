import { Alert, AlertDescription, AlertTitle } from "@pier/ui/alert.tsx";
import { Badge } from "@pier/ui/badge.tsx";
import { Button } from "@pier/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@pier/ui/card.tsx";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@pier/ui/collapsible.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from "@pier/ui/item.tsx";
import { Skeleton } from "@pier/ui/skeleton.tsx";
import type {
  PluginRegistryEntry,
  PluginRegistryListResult,
} from "@shared/contracts/plugin.ts";
import i18next from "i18next";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Fragment, useCallback, useEffect, useState } from "react";
import { useT } from "@/i18n/use-t.ts";
import { refreshBuiltinPlugins } from "@/lib/plugins/bootstrap.ts";
import { resolvePluginDisplay } from "@/lib/plugins/display.ts";
import {
  commandContributionBadges,
  contributionSummary,
  PluginDetails,
  panelContributionBadges,
  terminalStatusContributionBadges,
} from "./plugin-details.tsx";

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
  const [detailsOpen, setDetailsOpen] = useState(false);
  const canToggle = entry.runtime.canToggle;
  const commandContributions = commandContributionBadges(
    entry,
    i18next.language
  );
  const panelContributions = panelContributionBadges(entry, i18next.language);
  const terminalStatusContributions = terminalStatusContributionBadges(
    entry,
    i18next.language
  );
  const display = resolvePluginDisplay(entry, i18next.language);
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
  const sourceLabel = t(
    `settings.plugins.source.${entry.manifest.source.kind}`
  );
  const detailsLabel = detailsOpen
    ? t("settings.plugins.details.hide")
    : t("settings.plugins.details.show");
  const detailsAriaLabel = detailsOpen
    ? t("settings.plugins.details.hidePlugin", { name: display.name })
    : t("settings.plugins.details.showPlugin", { name: display.name });

  return (
    <Collapsible onOpenChange={setDetailsOpen} open={detailsOpen}>
      <Item
        className="rounded-none border-0 px-(--card-spacing)"
        data-testid={`plugin-row-${entry.manifest.id}`}
        role="listitem"
      >
        <ItemContent className="min-w-0">
          <ItemTitle className="max-w-full">
            <span className="truncate">{display.name}</span>
            <Badge variant={entry.runtime.enabled ? "secondary" : "outline"}>
              {statusLabel}
            </Badge>
            <Badge variant="outline">{sourceLabel}</Badge>
          </ItemTitle>
          <ItemDescription className="text-xs">
            {display.description ?? contributionSummary(entry, t)}
          </ItemDescription>
          {display.description ? (
            <ItemDescription className="text-xs">
              {contributionSummary(entry, t)}
            </ItemDescription>
          ) : null}
        </ItemContent>
        <ItemActions>
          <CollapsibleTrigger asChild>
            <Button
              aria-label={detailsAriaLabel}
              size="sm"
              type="button"
              variant="ghost"
            >
              {detailsOpen ? <ChevronDown /> : <ChevronRight />}
              {detailsLabel}
            </Button>
          </CollapsibleTrigger>
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
        </ItemActions>

        {detailsOpen ? (
          <CollapsibleContent asChild forceMount>
            <PluginDetails
              commandContributions={commandContributions}
              entry={entry}
              panelContributions={panelContributions}
              terminalStatusContributions={terminalStatusContributions}
            />
          </CollapsibleContent>
        ) : null}
      </Item>
    </Collapsible>
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
        <Fragment key={entry.manifest.id}>
          {index > 0 ? <ItemSeparator className="my-0" /> : null}
          <PluginRow
            entry={entry}
            onToggle={onToggle}
            pending={pendingId === entry.manifest.id}
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
    setPendingId(entry.manifest.id);
    const request = entry.enabled
      ? window.pier.plugins.disable(entry.manifest.id)
      : window.pier.plugins.enable(entry.manifest.id);
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
