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
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from "@pier/ui/item.tsx";
import { Skeleton } from "@pier/ui/skeleton.tsx";
import {
  GIT_PLUGIN_ID,
  type PluginRegistryEntry,
} from "@shared/contracts/plugin.ts";
import i18next from "i18next";
import {
  Activity,
  ArrowRight,
  Command,
  GitBranch,
  type LucideIcon,
  PanelsTopLeft,
  Puzzle,
} from "lucide-react";
import { Fragment, useState } from "react";
import { useT } from "@/i18n/use-t.ts";
import { resolvePluginDisplay } from "@/lib/plugins/display.ts";
import { pluginSectionId } from "@/pages/settings/data/appearance-nav.ts";
import { usePluginRegistryStore } from "@/stores/plugin-registry.store.ts";
import { useSettingsDialogStore } from "@/stores/settings-dialog.store.ts";

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

/**
 * 当前所有插件均为 builtin source(schema 已支持 local/git/registry, 但尚无实例)。
 * 没有 manifest.icon 字段可读 —— builtin git 特判为 GitBranch, 其余 lucide Puzzle
 * 兜底。出现非 builtin source 时再按 3-tabs 详情页方案扩展(spec 变更记录 2026-07-03)。
 */
function pluginRowIcon(entry: PluginRegistryEntry): LucideIcon {
  return entry.manifest.id === GIT_PLUGIN_ID ? GitBranch : Puzzle;
}

interface ContributionCountItem {
  Icon: LucideIcon;
  id: string;
  label: string;
}

/** 只保留非零的贡献点计数, 每项配一个 lucide 图标。 */
function contributionCountItems(
  entry: PluginRegistryEntry,
  t: ReturnType<typeof useT>
): ContributionCountItem[] {
  const counts: {
    Icon: LucideIcon;
    count: number;
    id: string;
    pluralKey: string;
    singularKey: string;
  }[] = [
    {
      Icon: Command,
      count: entry.manifest.commands.length,
      id: "commands",
      pluralKey: "settings.plugins.contributionSummary.commands",
      singularKey: "settings.plugins.contributionSummary.command",
    },
    {
      Icon: PanelsTopLeft,
      count: entry.manifest.panels.length,
      id: "panels",
      pluralKey: "settings.plugins.contributionSummary.panels",
      singularKey: "settings.plugins.contributionSummary.panel",
    },
    {
      Icon: Activity,
      count: entry.manifest.terminalStatusItems.length,
      id: "terminalStatusItems",
      pluralKey: "settings.plugins.contributionSummary.terminalStatusItems",
      singularKey: "settings.plugins.contributionSummary.terminalStatusItem",
    },
  ];
  return counts
    .filter((item) => item.count > 0)
    .map((item) => ({
      Icon: item.Icon,
      id: item.id,
      label: t(item.count === 1 ? item.singularKey : item.pluralKey, {
        count: item.count,
      }),
    }));
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
  const canToggle = entry.runtime.canToggle;
  const display = resolvePluginDisplay(entry, i18next.language);
  const RowIcon = pluginRowIcon(entry);
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
  const isBuiltin = entry.manifest.source.kind === "builtin";
  const sourceLabel = t(
    `settings.plugins.source.${entry.manifest.source.kind}`
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
            {isBuiltin ? null : <Badge variant="outline">{sourceLabel}</Badge>}
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
      </ItemContent>
    </Item>
  );
}

function PluginsListContent({
  entries,
  initialized,
  onToggle,
  pendingId,
}: {
  entries: readonly PluginRegistryEntry[];
  initialized: boolean;
  onToggle(entry: PluginRegistryEntry): void;
  pendingId: string | null;
}) {
  if (!initialized) {
    return <PluginsLoadingState />;
  }

  if (entries.length === 0) {
    return <PluginsEmptyState />;
  }

  return (
    <ItemGroup className="gap-0">
      {entries.map((entry, index) => (
        <Fragment key={entry.manifest.id}>
          {index > 0 ? (
            <ItemSeparator className="mx-(--card-spacing) my-0 data-horizontal:w-auto" />
          ) : null}
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
  const plugins = usePluginRegistryStore((state) => state.plugins);
  const diagnostics = usePluginRegistryStore((state) => state.diagnostics);
  const initialized = usePluginRegistryStore((state) => state.initialized);
  const storeError = usePluginRegistryStore((state) => state.error);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const togglePlugin = (entry: PluginRegistryEntry) => {
    setPendingId(entry.manifest.id);
    setToggleError(null);
    const request = entry.enabled
      ? window.pier.plugins.disable(entry.manifest.id)
      : window.pier.plugins.enable(entry.manifest.id);
    request
      // PLUGINS_CHANGED 广播会同步所有窗口(含本窗口); 这里在 resolve 路径
      // 再显式 refresh 一次, 让发起窗口不依赖广播到达时序, 与 preferences
      // 的"发起端确定性更新"约定一致。runtime 刷新由 bootstrap 的 store
      // 订阅按运行态集合去重, 不会重复 reactivate。
      .then(() => usePluginRegistryStore.getState().refresh())
      .catch((err: unknown) => {
        setToggleError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setPendingId(null);
      });
  };

  const error = toggleError ?? storeError;

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
          {diagnostics.length ? (
            <div className="px-(--card-spacing)">
              <Alert>
                <AlertTitle>
                  {t("settings.plugins.diagnosticsTitle")}
                </AlertTitle>
                <AlertDescription>
                  <div className="flex flex-col gap-1">
                    {diagnostics.map((diagnostic) => (
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
            entries={plugins}
            initialized={initialized}
            onToggle={togglePlugin}
            pendingId={pendingId}
          />
        </CardContent>
      </Card>
    </div>
  );
}
