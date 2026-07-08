import { Button } from "@pier/ui/button.tsx";
import { Item, ItemContent, ItemTitle } from "@pier/ui/item.tsx";
import type {
  ManagedPluginCatalogSnapshot,
  ManagedPluginOperationResult,
} from "@shared/contracts/managed-plugin.ts";
import i18next from "i18next";
import { Loader2, Package } from "lucide-react";
import { type JSX, useState } from "react";
import { toast } from "sonner";
import { useT } from "@/i18n/use-t.ts";
import {
  type ContributionCounts,
  contributionCountItemsFromCounts,
} from "./plugin-row.tsx";

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

function isManagedOperationFailure(
  result: unknown
): result is Extract<ManagedPluginOperationResult, { ok: false }> {
  return (
    typeof result === "object" &&
    result !== null &&
    "ok" in result &&
    result.ok === false &&
    "error" in result &&
    typeof result.error === "object" &&
    result.error !== null &&
    "message" in result.error &&
    typeof result.error.message === "string"
  );
}

export function rejectFailedManagedPluginOperation<T>(
  op: Promise<T>
): Promise<T> {
  return op.then((result) => {
    if (isManagedOperationFailure(result)) {
      throw new Error(result.error.message);
    }
    return result;
  });
}

/**
 * Shared across install/uninstall/update/rollback buttons.
 *   - flips `pending` while the promise is in-flight
 *   - drives sonner `toast.promise` (loading → success/error)
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
    const p = rejectFailedManagedPluginOperation(op).finally(() => {
      setPending(false);
      onRefresh();
    });
    toast.promise(p, {
      loading: t(`settings.plugins.toast.${LOADING_KEY[kind]}`, { name }),
      success: () =>
        t(`settings.plugins.toast.${SUCCESS_KEY[kind]}`, {
          name,
          ...(values ?? {}),
        }),
      error: (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        return `${t(`settings.plugins.toast.${FAILED_KEY[kind]}`, { name })} — ${msg}`;
      },
    });
  };
  return { pending, run };
}

function Spinner({ pending }: { pending: boolean }): JSX.Element | null {
  return pending ? (
    <Loader2 aria-hidden className="size-3.5 animate-spin" />
  ) : null;
}

/** Actions attached to an installed managed plugin row. */
export function ManagedRowExtraActions({
  row,
  win,
  onRefresh,
}: {
  row: CatalogRow;
  win: ManagedPluginsWindowShim | undefined;
  onRefresh: () => void;
}): JSX.Element {
  const t = useT();
  const display = resolveRowDisplay(row);
  const { pending, run } = usePluginOp(display.name, onRefresh);
  return (
    <>
      {row.update ? (
        <Button
          disabled={pending}
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
      {row.lastKnownGoodVersion &&
      row.effective &&
      row.lastKnownGoodVersion !== row.effective.version ? (
        <Button
          disabled={pending}
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
        disabled={pending}
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

function ContributionCountsInline({
  counts,
}: {
  counts: ContributionCounts | undefined;
}): JSX.Element {
  const t = useT();
  if (!counts) return <span />;
  const items = contributionCountItemsFromCounts(counts, t);
  if (items.length === 0) {
    return (
      <span className="text-muted-foreground text-xs">
        {t("settings.plugins.contributionSummary.none")}
      </span>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
      {items.map(({ Icon, id, label }) => (
        <span className="inline-flex items-center gap-1" key={id}>
          <Icon aria-hidden className="size-3.5" />
          {label}
        </span>
      ))}
    </div>
  );
}

/** Minimal row for a plugin known only by the catalog (bundled/available). */
export function AvailableManagedRow({
  row,
  win,
  onRefresh,
}: {
  row: CatalogRow;
  win: ManagedPluginsWindowShim | undefined;
  onRefresh: () => void;
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
      <ItemContent className="min-w-0 gap-1.5">
        <div className="flex w-full items-center justify-between gap-2">
          <ItemTitle className="min-w-0">
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
          <p className="text-muted-foreground text-xs">{display.description}</p>
        ) : null}
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <ContributionCountsInline counts={row.contributionCounts} />
          <Button
            disabled={pending}
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
        </div>
      </ItemContent>
    </Item>
  );
}
