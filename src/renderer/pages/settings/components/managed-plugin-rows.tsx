import { Badge } from "@pier/ui/badge.tsx";
import { Button } from "@pier/ui/button.tsx";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@pier/ui/item.tsx";
import type { ManagedPluginCatalogSnapshot } from "@shared/contracts/plugin/managed.ts";
import i18next from "i18next";
import { Loader2, Package } from "lucide-react";
import { type JSX, useState } from "react";
import { toast } from "sonner";
import { useT } from "@/i18n/use-t.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import { rejectFailedManagedPluginOperation } from "./managed-plugin-operation.ts";
import { PluginEnableSwitch } from "./plugin-row.tsx";

/**
 * Row helpers for `ManagedPluginsSection`.
 * Split from that file to keep it under the file-size hard cap.
 */

export type CatalogRow = ManagedPluginCatalogSnapshot["plugins"][number];

/**
 * Pick locale-aware name/description from a catalog row.
 * Falls back to fields on the row itself when no locale entry matches.
 */
function resolveRowDisplay(row: CatalogRow): {
  name: string;
  description?: string;
} {
  const locale = i18next.language ?? "";
  const shortLocale = locale.split("-")[0] ?? "";
  const candidates = [locale, shortLocale].filter((v): v is string =>
    Boolean(v)
  );
  for (const code of candidates) {
    const msg = row.locales?.[code];
    if (msg?.name || msg?.description) {
      const description = msg.description ?? row.description;
      return {
        name: msg.name ?? row.displayName,
        ...(description ? { description } : {}),
      };
    }
  }
  return {
    name: row.displayName,
    ...(row.description ? { description: row.description } : {}),
  };
}

export interface ManagedPluginsWindowShim {
  app?: {
    relaunch(): Promise<void>;
  };
  managedPlugins?: {
    list(): Promise<ManagedPluginCatalogSnapshot>;
    checkUpdates(): Promise<ManagedPluginCatalogSnapshot>;
    disable(id: string): Promise<unknown>;
    enable(id: string): Promise<unknown>;
    rollback(id: string, version: string): Promise<unknown>;
    uninstall(id: string): Promise<unknown>;
    install(id: string): Promise<unknown>;
    update(id: string): Promise<unknown>;
  };
}

type OpKind = "install" | "uninstall" | "update" | "rollback";

const LOADING_KEY: Record<OpKind, string> = {
  install: "installing",
  uninstall: "uninstalling",
  update: "updating",
  rollback: "rollingBack",
};
const SUCCESS_KEY: Record<OpKind, string> = {
  install: "installed",
  uninstall: "uninstalled",
  update: "updated",
  rollback: "rolledBack",
};
const FAILED_KEY: Record<OpKind, string> = {
  install: "installFailed",
  uninstall: "uninstallFailed",
  update: "updateFailed",
  rollback: "rollbackFailed",
};

/**
 * Shared across install/uninstall/update/rollback buttons.
 *   - flips `pending` while the promise is in-flight
 *   - loading/success toast；失败详情走 showAppAlert（不塞 toast description）
 *   - refreshes the catalog on completion
 */
export function usePluginOp(
  name: string,
  onRefresh: () => void
): {
  pending: boolean;
  run(
    op: Promise<unknown> | undefined,
    kind: OpKind,
    values?: { version?: string }
  ): void;
} {
  const t = useT();
  const [pending, setPending] = useState(false);
  const run = (
    op: Promise<unknown> | undefined,
    kind: OpKind,
    values?: { version?: string }
  ): void => {
    if (!op) return;
    setPending(true);
    const loadingId = toast.loading(
      t(`settings.plugins.toast.${LOADING_KEY[kind]}`, { name })
    );
    rejectFailedManagedPluginOperation(op)
      .then(() => {
        toast.success(
          t(`settings.plugins.toast.${SUCCESS_KEY[kind]}`, {
            name,
            ...(values ?? {}),
          }),
          { id: loadingId }
        );
      })
      .catch((err: unknown) => {
        toast.dismiss(loadingId);
        showAppAlert({
          title: t(`settings.plugins.toast.${FAILED_KEY[kind]}`, { name }),
          body: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        setPending(false);
        onRefresh();
      });
  };
  return { pending, run };
}

function Spinner({ pending }: { pending: boolean }): JSX.Element | null {
  return pending ? (
    <Loader2 aria-hidden className="animate-spin" data-icon="inline-start" />
  ) : null;
}

/** Actions attached to an installed managed plugin row. */
export function ManagedRowExtraActions({
  row,
  win,
  onRefresh,
  officialMutationsAllowed = true,
  mutationsLocked = false,
}: {
  row: CatalogRow;
  win: ManagedPluginsWindowShim | undefined;
  onRefresh: () => void;
  /** When false (workspace mode), hide official update/rollback. */
  officialMutationsAllowed?: boolean;
  /** When true (batch update in flight), disable mutate buttons. */
  mutationsLocked?: boolean;
}): JSX.Element {
  const t = useT();
  const display = resolveRowDisplay(row);
  const { pending, run } = usePluginOp(display.name, onRefresh);
  return (
    <>
      {officialMutationsAllowed && row.update ? (
        <Button
          disabled={pending || mutationsLocked}
          onClick={() => {
            const v = row.update?.version;
            run(
              win?.managedPlugins?.update(row.id),
              "update",
              v ? { version: v } : undefined
            );
          }}
          size="sm"
          type="button"
          variant="default"
        >
          <Spinner pending={pending} />
          {t("settings.plugins.action.update")}
        </Button>
      ) : null}
      {officialMutationsAllowed &&
      row.lastKnownGoodVersion &&
      row.effective &&
      row.lastKnownGoodVersion !== row.effective.version ? (
        <Button
          disabled={pending || mutationsLocked}
          onClick={() => {
            const lkg = row.lastKnownGoodVersion;
            if (!lkg) return;
            run(win?.managedPlugins?.rollback(row.id, lkg), "rollback", {
              version: lkg,
            });
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          <Spinner pending={pending} />
          {t("settings.plugins.action.rollback", {
            version: row.lastKnownGoodVersion,
          })}
        </Button>
      ) : null}
      <Button
        disabled={pending || mutationsLocked}
        onClick={() => run(win?.managedPlugins?.uninstall(row.id), "uninstall")}
        size="sm"
        type="button"
        variant="outline"
      >
        <Spinner pending={pending} />
        {t("settings.plugins.action.uninstall")}
      </Button>
    </>
  );
}

/** Minimal row for a plugin known only by the catalog (bundled/available). */
export function AvailableManagedRow({
  row,
  win,
  onRefresh,
  mutationsLocked = false,
}: {
  row: CatalogRow;
  win: ManagedPluginsWindowShim | undefined;
  onRefresh: () => void;
  mutationsLocked?: boolean;
}): JSX.Element {
  const t = useT();
  const display = resolveRowDisplay(row);
  const { pending, run } = usePluginOp(display.name, onRefresh);
  return (
    <Item
      className="rounded-none border-0 px-(--card-spacing)"
      data-testid={`plugin-row-${row.id}`}
      role="listitem"
    >
      <ItemContent className="min-w-0 gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <ItemTitle className="min-w-0 max-w-full">
            <Package
              aria-hidden
              className="size-4 shrink-0 text-muted-foreground"
            />
            <span className="truncate">{display.name}</span>
          </ItemTitle>
          <span className="shrink-0 text-muted-foreground text-xs">
            {row.update ? `v${row.update.version}` : "—"}
          </span>
        </div>
        {display.description ? (
          <ItemDescription className="text-xs">
            {display.description}
          </ItemDescription>
        ) : null}
      </ItemContent>
      <ItemActions className="shrink-0">
        <Button
          disabled={pending || mutationsLocked}
          onClick={() => {
            const v = row.update?.version;
            run(
              win?.managedPlugins?.install(row.id),
              "install",
              v ? { version: v } : undefined
            );
          }}
          size="sm"
          type="button"
          variant="default"
        >
          <Spinner pending={pending} />
          {t("settings.plugins.action.install")}
        </Button>
      </ItemActions>
    </Item>
  );
}

/** Installed catalog entry whose runtime registry entry is currently absent. */
export function UnavailableManagedRow({
  onRefresh,
  onToggle,
  pending,
  row,
  win,
  officialMutationsAllowed = true,
  mutationsLocked = false,
}: {
  onRefresh: () => void;
  onToggle: () => void;
  pending: boolean;
  row: CatalogRow;
  win: ManagedPluginsWindowShim | undefined;
  officialMutationsAllowed?: boolean;
  mutationsLocked?: boolean;
}): JSX.Element {
  const t = useT();
  const display = resolveRowDisplay(row);
  const version = row.desired.version ?? row.effective?.version;
  const description = row.desired.enabled
    ? t("settings.plugins.runtimeUnavailableDescription")
    : display.description;
  return (
    <Item
      className="rounded-none border-0 px-(--card-spacing)"
      data-testid={`plugin-row-${row.id}`}
      role="listitem"
    >
      <ItemContent className="min-w-0 gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <ItemTitle className="min-w-0 max-w-full">
            <Package
              aria-hidden
              className="size-4 shrink-0 text-muted-foreground"
            />
            <span className="truncate">{display.name}</span>
            {row.desired.enabled ? (
              <Badge variant="destructive">
                {t("settings.plugins.status.runtimeUnavailable")}
              </Badge>
            ) : null}
          </ItemTitle>
          <span className="shrink-0 text-muted-foreground text-xs">
            {version ? `v${version}` : "—"}
          </span>
        </div>
        {description ? (
          <ItemDescription className="text-xs">{description}</ItemDescription>
        ) : null}
      </ItemContent>
      <ItemActions className="shrink-0">
        <ManagedRowExtraActions
          mutationsLocked={mutationsLocked}
          officialMutationsAllowed={officialMutationsAllowed}
          onRefresh={onRefresh}
          row={row}
          win={win}
        />
        <PluginEnableSwitch
          checked={row.desired.enabled}
          disabled={pending || mutationsLocked}
          name={display.name}
          onToggle={onToggle}
        />
      </ItemActions>
    </Item>
  );
}
