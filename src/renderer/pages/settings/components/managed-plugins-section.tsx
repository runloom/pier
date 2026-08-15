import { Button } from "@pier/ui/button.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
import { ItemGroup, ItemSeparator } from "@pier/ui/item.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@pier/ui/tabs.tsx";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@pier/ui/tooltip.tsx";
import { cn } from "@pier/ui/utils.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import i18next from "i18next";
import { Loader2, Puzzle, RefreshCw } from "lucide-react";
import {
  Fragment,
  type JSX,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from "react";
import { toast } from "sonner";
import { useT } from "@/i18n/use-t.ts";
import { systemNotify } from "@/lib/notifications/system-notify.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import { useManagedPluginCatalog } from "@/stores/host-catalog/use-managed-plugin-catalog.ts";
import { rejectFailedManagedPluginOperation } from "./managed-plugin-operation.ts";
import {
  AvailableManagedRow,
  type CatalogRow,
  type ManagedPluginsWindowShim,
  ManagedRowExtraActions,
  UnavailableManagedRow,
} from "./managed-plugin-rows.tsx";
import { sortUnifiedRows, type UnifiedRow } from "./plugin-list-order.ts";
import { PluginRow, PluginsLoadingState } from "./plugin-row.tsx";
import { useManagedPluginUpdateAll } from "./use-managed-plugin-update-all.ts";

/**
 * Unified plugin management section.
 *
 * Tabs at the top show all plugins in two buckets:
 *  - Installed = built-in + managed installed (rendered as full `PluginRow`,
 *    managed entries add Uninstall / Update / Rollback via `extraActions`).
 *  - Available = managed catalog rows where `installed=false` (bundled or
 *    remote official plugin not yet installed) → minimal row with Install.
 * "Check for Updates" and "Restart Pier Now" are page-level controls.
 */

function EmptyList({
  emptyKey,
}: {
  emptyKey: "emptyInstalled" | "emptyAvailable";
}): JSX.Element {
  const t = useT();
  return (
    <Empty className="py-8">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Puzzle aria-hidden />
        </EmptyMedia>
        <EmptyTitle>{t(`settings.plugins.${emptyKey}Title`)}</EmptyTitle>
        <EmptyDescription>
          {t(`settings.plugins.${emptyKey}Description`)}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function UnifiedList({
  rows,
  win,
  onRefreshManaged,
  onToggleManaged,
  onToggleBuiltin,
  pendingManagedId,
  pendingBuiltinId,
  emptyKey,
  officialMutationsAllowed = true,
  mutationsLocked = false,
}: {
  rows: readonly UnifiedRow[];
  win: ManagedPluginsWindowShim | undefined;
  onRefreshManaged: () => void;
  onToggleManaged(row: CatalogRow): void;
  onToggleBuiltin(entry: PluginRegistryEntry): void;
  pendingManagedId: string | null;
  pendingBuiltinId: string | null;
  emptyKey: "emptyInstalled" | "emptyAvailable";
  officialMutationsAllowed?: boolean;
  mutationsLocked?: boolean;
}): JSX.Element {
  if (rows.length === 0) {
    return <EmptyList emptyKey={emptyKey} />;
  }
  return (
    <ItemGroup className="gap-0" role="list">
      {rows.map((row, index) => {
        const key = row.kind === "entry" ? row.entry.manifest.id : row.row.id;
        if (row.kind === "available") {
          return (
            <Fragment key={key}>
              {index > 0 ? (
                <ItemSeparator className="mx-(--card-spacing) my-0 data-horizontal:w-auto" />
              ) : null}
              <AvailableManagedRow
                mutationsLocked={mutationsLocked}
                onRefresh={onRefreshManaged}
                row={row.row}
                win={win}
              />
            </Fragment>
          );
        }
        if (row.kind === "unavailable") {
          return (
            <Fragment key={key}>
              {index > 0 ? (
                <ItemSeparator className="mx-(--card-spacing) my-0 data-horizontal:w-auto" />
              ) : null}
              <UnavailableManagedRow
                mutationsLocked={mutationsLocked}
                officialMutationsAllowed={officialMutationsAllowed}
                onRefresh={onRefreshManaged}
                onToggle={() => onToggleManaged(row.row)}
                pending={mutationsLocked || pendingManagedId === row.row.id}
                row={row.row}
                win={win}
              />
            </Fragment>
          );
        }
        const managedRow = row.managedRow;
        const displayEntry = managedRow
          ? withManagedDesiredState(row.entry, managedRow)
          : row.entry;
        const extraActions: ReactNode = managedRow ? (
          <ManagedRowExtraActions
            mutationsLocked={mutationsLocked}
            officialMutationsAllowed={officialMutationsAllowed}
            onRefresh={onRefreshManaged}
            row={managedRow}
            win={win}
          />
        ) : null;
        return (
          <Fragment key={key}>
            {index > 0 ? (
              <ItemSeparator className="mx-(--card-spacing) my-0 data-horizontal:w-auto" />
            ) : null}
            <PluginRow
              entry={displayEntry}
              extraActions={extraActions}
              onToggle={
                managedRow ? () => onToggleManaged(managedRow) : onToggleBuiltin
              }
              pending={
                managedRow
                  ? mutationsLocked ||
                    pendingManagedId === row.entry.manifest.id
                  : pendingBuiltinId === row.entry.manifest.id
              }
            />
          </Fragment>
        );
      })}
    </ItemGroup>
  );
}

function withManagedDesiredState(
  entry: PluginRegistryEntry,
  row: CatalogRow
): PluginRegistryEntry {
  return {
    ...entry,
    enabled: row.desired.enabled,
    runtime: {
      ...entry.runtime,
      enabled: row.desired.enabled,
    },
  };
}

function errorDescription(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function ManagedPluginsSection({
  builtinEntries,
  builtinInitialized,
  onCatalogStatusChange,
  onToggleBuiltin,
  pendingBuiltinId,
}: {
  builtinEntries: readonly PluginRegistryEntry[];
  builtinInitialized: boolean;
  onCatalogStatusChange?(status: {
    pluginMode: "workspace" | "release";
    catalogError: string | null;
  }): void;
  onToggleBuiltin(entry: PluginRegistryEntry): void;
  pendingBuiltinId: string | null;
}): JSX.Element {
  const t = useT();
  const { catalog, refresh, checkUpdates, checkingUpdates, error, win } =
    useManagedPluginCatalog();
  const [pendingManagedId, setPendingManagedId] = useState<string | null>(null);
  const { showUpdateAll, updatingAll, handleUpdateAll } =
    useManagedPluginUpdateAll({ catalog, refresh, win });
  const mutationsLocked = updatingAll;

  const managedById = new Map(catalog?.plugins.map((p) => [p.id, p]) ?? []);
  // Trust catalog.installed over registry presence: main broadcasts
  // PLUGINS_CHANGED asynchronously after mutate, so a Uninstall click updates
  // the catalog first and the registry a beat later. Hide any managed entry
  // the catalog no longer reports as installed — it'll surface in Not Installed.
  const runtimeIds = new Set(builtinEntries.map((entry) => entry.manifest.id));
  const unsortedInstalledRows: UnifiedRow[] = builtinEntries
    .filter((entry) => {
      const managedRow = managedById.get(entry.manifest.id);
      return !managedRow || managedRow.installed;
    })
    .map((entry) => ({
      kind: "entry",
      entry,
      managedRow: managedById.get(entry.manifest.id) ?? null,
    }));
  unsortedInstalledRows.push(
    ...(catalog?.plugins ?? [])
      .filter((row) => row.installed && !runtimeIds.has(row.id))
      .map((row): UnifiedRow => ({ kind: "unavailable", row }))
  );
  // Deterministic order (VS Code / JetBrains convention): restart-pending
  // rows first, then locale-aware alphabetical — never first-install order.
  const installedRows = sortUnifiedRows(
    unsortedInstalledRows,
    i18next.language
  );
  const installedIds = new Set(
    installedRows.flatMap((r) =>
      r.kind === "entry" ? [r.entry.manifest.id] : []
    )
  );
  const availableRows: UnifiedRow[] = sortUnifiedRows(
    (catalog?.plugins ?? [])
      .filter((p) => !(p.installed || installedIds.has(p.id)))
      .map((row) => ({ kind: "available", row })),
    i18next.language
  );
  const anyPendingRestart = catalog?.plugins.some(
    (p) => p.pendingRestart !== null
  );

  const toggleManaged = useCallback(
    (row: CatalogRow): void => {
      if (updatingAll) return;
      const request = row.desired.enabled
        ? win?.managedPlugins?.disable(row.id)
        : win?.managedPlugins?.enable(row.id);
      if (!request) {
        return;
      }
      setPendingManagedId(row.id);
      rejectFailedManagedPluginOperation(request)
        .then(refresh)
        .catch((err: unknown) => {
          // 带技术详情的失败：alert 展示 + 消息中心留痕（操作反馈规范）。
          const titleKey = row.desired.enabled
            ? "settings.plugins.toast.disableFailed"
            : "settings.plugins.toast.enableFailed";
          const body = err instanceof Error ? err.message : String(err);
          showAppAlert({
            body,
            title: i18next.t(titleKey, { name: row.id }),
          }).catch(() => undefined);
          systemNotify({
            body,
            kind: "operation.result",
            severity: "error",
            suppressToast: true,
            titleKey,
            titleParams: { name: row.id },
          });
        })
        .finally(() => {
          setPendingManagedId(null);
        });
    },
    [refresh, updatingAll, win]
  );
  const handleCheckUpdates = useCallback((): void => {
    checkUpdates()
      .then((next) => {
        if (!next) return;
        toast.success(t("settings.plugins.toast.checkUpdatesSuccess"));
      })
      .catch((err: unknown) => {
        showAppAlert({
          title: t("settings.plugins.toast.checkUpdatesFailed"),
          body: errorDescription(err),
        });
      });
  }, [checkUpdates, t]);

  const pluginMode = catalog?.pluginMode ?? "release";

  useEffect(() => {
    onCatalogStatusChange?.({
      pluginMode,
      catalogError: error,
    });
  }, [error, onCatalogStatusChange, pluginMode]);

  if (!builtinInitialized) {
    return <PluginsLoadingState />;
  }

  const officialMutationsAllowed = catalog?.officialMutationsAllowed ?? true;

  return (
    <div className="flex flex-col gap-2">
      <Tabs defaultValue="installed">
        <div className="mx-(--card-spacing) flex items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="installed">
              {t("settings.plugins.tabs.installed")}
            </TabsTrigger>
            <TabsTrigger value="available">
              {t("settings.plugins.tabs.available")}
            </TabsTrigger>
          </TabsList>
          <div className="flex shrink-0 items-center gap-2">
            {anyPendingRestart ? (
              <Button
                onClick={() => {
                  if (import.meta.env.DEV) {
                    toast.info(t("settings.plugins.restartDevNotice"));
                  }
                  win?.app?.relaunch().catch((err: unknown) => {
                    console.error("[managed-plugins] relaunch failed:", err);
                  });
                }}
                size="sm"
                type="button"
                variant="default"
              >
                {t("settings.plugins.restartNow")}
              </Button>
            ) : null}
            {showUpdateAll ? (
              <Button
                disabled={updatingAll}
                onClick={handleUpdateAll}
                size="sm"
                type="button"
                variant="default"
              >
                {updatingAll ? (
                  <Loader2
                    aria-hidden
                    className="animate-spin"
                    data-icon="inline-start"
                  />
                ) : null}
                {t("settings.plugins.action.updateAll")}
              </Button>
            ) : null}
            {officialMutationsAllowed ? (
              <TooltipProvider delayDuration={0} disableHoverableContent>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      aria-label={t("settings.plugins.checkUpdates")}
                      disabled={checkingUpdates || updatingAll}
                      onClick={handleCheckUpdates}
                      size="icon-sm"
                      type="button"
                      variant="outline"
                    >
                      <RefreshCw
                        aria-hidden
                        className={cn(checkingUpdates && "animate-spin")}
                        data-icon="inline-start"
                      />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t("settings.plugins.checkUpdates")}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : null}
          </div>
        </div>
        <TabsContent value="installed">
          <UnifiedList
            emptyKey="emptyInstalled"
            mutationsLocked={mutationsLocked}
            officialMutationsAllowed={officialMutationsAllowed}
            onRefreshManaged={refresh}
            onToggleBuiltin={onToggleBuiltin}
            onToggleManaged={toggleManaged}
            pendingBuiltinId={pendingBuiltinId}
            pendingManagedId={pendingManagedId}
            rows={installedRows}
            win={win}
          />
        </TabsContent>
        <TabsContent value="available">
          <UnifiedList
            emptyKey="emptyAvailable"
            mutationsLocked={mutationsLocked}
            officialMutationsAllowed={officialMutationsAllowed}
            onRefreshManaged={refresh}
            onToggleBuiltin={onToggleBuiltin}
            onToggleManaged={toggleManaged}
            pendingBuiltinId={pendingBuiltinId}
            pendingManagedId={pendingManagedId}
            rows={availableRows}
            win={win}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
