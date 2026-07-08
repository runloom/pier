import { Button } from "@pier/ui/button.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
import { ItemGroup, ItemSeparator } from "@pier/ui/item.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@pier/ui/tabs.tsx";
import type { ManagedPluginCatalogSnapshot } from "@shared/contracts/managed-plugin.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { AlertCircle, Package, PackageCheck, RefreshCw } from "lucide-react";
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
import {
  AvailableManagedRow,
  type CatalogRow,
  type ManagedPluginsWindowShim,
  ManagedRowExtraActions,
  rejectFailedManagedPluginOperation,
} from "./managed-plugin-rows.tsx";
import { PluginRow, PluginsLoadingState } from "./plugin-row.tsx";

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

function useCatalog(): {
  catalog: ManagedPluginCatalogSnapshot | null;
  refresh: () => void;
  checkUpdates: () => void;
  checkingUpdates: boolean;
  win: ManagedPluginsWindowShim | undefined;
} {
  const win = (window as unknown as { pier?: ManagedPluginsWindowShim }).pier;
  const [catalog, setCatalog] = useState<ManagedPluginCatalogSnapshot | null>(
    null
  );
  const [checkingUpdates, setCheckingUpdates] = useState(false);

  const refresh = useCallback((): void => {
    if (!win?.managedPlugins) return;
    win.managedPlugins
      .list()
      .then(setCatalog)
      .catch((err: unknown) => {
        console.error("[managed-plugins] list failed:", err);
      });
  }, []);

  const checkUpdates = useCallback((): void => {
    if (!win?.managedPlugins) return;
    setCheckingUpdates(true);
    win.managedPlugins
      .checkUpdates()
      .then(setCatalog)
      .catch((err: unknown) => {
        console.error("[managed-plugins] check updates failed:", err);
      })
      .finally(() => setCheckingUpdates(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { catalog, refresh, checkUpdates, checkingUpdates, win };
}

type UnifiedRow =
  | {
      kind: "entry";
      /** Registry entry (built-in or installed managed). */
      entry: PluginRegistryEntry;
      /** Set only when this entry is also a managed catalog row. */
      managedRow: CatalogRow | null;
    }
  | {
      kind: "available";
      row: CatalogRow;
    };

function EmptyList({
  emptyKey,
}: {
  emptyKey: "emptyInstalled" | "emptyAvailable";
}): JSX.Element {
  const t = useT();
  return (
    <Empty className="py-8">
      <EmptyHeader>
        <AlertCircle
          aria-hidden
          className="mx-auto size-6 text-muted-foreground"
        />
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
}: {
  rows: readonly UnifiedRow[];
  win: ManagedPluginsWindowShim | undefined;
  onRefreshManaged: () => void;
  onToggleManaged(entry: PluginRegistryEntry, row: CatalogRow): void;
  onToggleBuiltin(entry: PluginRegistryEntry): void;
  pendingManagedId: string | null;
  pendingBuiltinId: string | null;
  emptyKey: "emptyInstalled" | "emptyAvailable";
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
                onRefresh={onRefreshManaged}
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
                managedRow
                  ? (entry) => onToggleManaged(entry, managedRow)
                  : onToggleBuiltin
              }
              pending={
                managedRow
                  ? pendingManagedId === row.entry.manifest.id
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

export function ManagedPluginsSection({
  builtinEntries,
  builtinInitialized,
  onToggleBuiltin,
  pendingBuiltinId,
}: {
  builtinEntries: readonly PluginRegistryEntry[];
  builtinInitialized: boolean;
  onToggleBuiltin(entry: PluginRegistryEntry): void;
  pendingBuiltinId: string | null;
}): JSX.Element {
  const t = useT();
  const { catalog, refresh, checkUpdates, checkingUpdates, win } = useCatalog();
  const [pendingManagedId, setPendingManagedId] = useState<string | null>(null);

  const managedById = new Map(catalog?.plugins.map((p) => [p.id, p]) ?? []);
  // Trust catalog.installed over registry presence: main broadcasts
  // PLUGINS_CHANGED asynchronously after mutate, so a Uninstall click updates
  // the catalog first and the registry a beat later. Hide any managed entry
  // the catalog no longer reports as installed — it'll surface in Not Installed.
  const installedRows: UnifiedRow[] = builtinEntries
    .filter((entry) => {
      const managedRow = managedById.get(entry.manifest.id);
      return !managedRow || managedRow.installed;
    })
    .map((entry) => ({
      kind: "entry",
      entry,
      managedRow: managedById.get(entry.manifest.id) ?? null,
    }));
  const installedIds = new Set(
    installedRows.flatMap((r) =>
      r.kind === "entry" ? [r.entry.manifest.id] : []
    )
  );
  const availableRows: UnifiedRow[] = (catalog?.plugins ?? [])
    .filter((p) => !(p.installed || installedIds.has(p.id)))
    .map((row) => ({ kind: "available", row }));
  const anyPendingRestart = catalog?.plugins.some(
    (p) => p.pendingRestart !== null
  );

  const toggleManaged = useCallback(
    (entry: PluginRegistryEntry, row: CatalogRow): void => {
      const request = row.desired.enabled
        ? win?.managedPlugins?.disable(entry.manifest.id)
        : win?.managedPlugins?.enable(entry.manifest.id);
      if (!request) {
        return;
      }
      setPendingManagedId(entry.manifest.id);
      rejectFailedManagedPluginOperation(request)
        .then(refresh)
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          toast.error(message);
        })
        .finally(() => {
          setPendingManagedId(null);
        });
    },
    [refresh, win]
  );

  if (!builtinInitialized) {
    return <PluginsLoadingState />;
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 px-(--card-spacing)">
        <p className="text-muted-foreground text-xs">
          {t("settings.plugins.trustNotice")}
        </p>
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
          <Button
            disabled={checkingUpdates}
            onClick={checkUpdates}
            size="sm"
            type="button"
            variant="outline"
          >
            <RefreshCw aria-hidden className="size-3.5" />
            {t("settings.plugins.checkUpdates")}
          </Button>
        </div>
      </div>
      <Tabs defaultValue="installed">
        <TabsList className="mx-(--card-spacing)">
          <TabsTrigger value="installed">
            <PackageCheck aria-hidden className="size-3.5" />
            {t("settings.plugins.tabs.installed")} · {installedRows.length}
          </TabsTrigger>
          <TabsTrigger value="available">
            <Package aria-hidden className="size-3.5" />
            {t("settings.plugins.tabs.available")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="installed">
          <UnifiedList
            emptyKey="emptyInstalled"
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
