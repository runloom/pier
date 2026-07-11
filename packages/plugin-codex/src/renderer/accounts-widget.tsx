import type {
  ExternalRendererPluginContext,
  MissionControlWidgetComponentProps,
} from "@pier/plugin-api/renderer";
import { formatRelativeTime } from "@pier/ui/format.tsx";
import {
  WidgetEmpty,
  WidgetError,
  WidgetSkeleton,
} from "@pier/ui/widget-state.tsx";
import { Orbit } from "lucide-react";
import type { JSX } from "react";
import { useEffect, useRef } from "react";
import { AccountPicker } from "./account-picker.tsx";
import { UsageMeter } from "./usage-meter.tsx";
import { useCodexAccountsSnapshot } from "./use-accounts-snapshot.ts";

/**
 * Codex usage widget for Mission Control.
 * Shows session/weekly usage, account picker, and manage accounts link.
 * Consumes host `visible` / `refreshToken` for lifecycle.
 */

export interface AccountsWidgetProps
  extends MissionControlWidgetComponentProps {
  context: ExternalRendererPluginContext;
}

export function AccountsWidget({
  context,
  refreshToken,
  visible,
}: AccountsWidgetProps): JSX.Element {
  const { error: loadError, snapshot } = useCodexAccountsSnapshot(context);
  const prevRefresh = useRef(refreshToken);
  const t = (key: string, fallback: string): string =>
    context.i18n.t(key, fallback);

  // Refresh usage when refreshToken increments
  useEffect(() => {
    if (visible && refreshToken !== prevRefresh.current) {
      prevRefresh.current = refreshToken;
      context.rpc
        .invoke("accounts.refreshUsage", null)
        .catch((err: unknown) => {
          context.dialogs.alert({
            title: context.i18n.t(
              "pier.codex.widget.refreshFailed",
              "Could not refresh Codex usage"
            ),
            body: err instanceof Error ? err.message : String(err),
          });
        });
    }
  }, [refreshToken, visible, context]);

  // Error state
  if (loadError) {
    return (
      <WidgetError message={loadError}>
        {t("pier.codex.widget.loadFailed", "Could not load Codex accounts")}
      </WidgetError>
    );
  }

  // Loading state
  if (!snapshot) {
    return <WidgetSkeleton data-slot="widget-skeleton" />;
  }

  // Usage data
  const usage = snapshot.activeUsage;
  const hasUsage = usage?.status === "ok";

  // No usage data state
  if (!hasUsage) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-3 p-3 text-sm">
        <div className="flex items-center gap-2">
          <Orbit aria-hidden="true" className="size-4 text-muted-foreground" />
          <span className="font-medium text-sm">Codex</span>
        </div>
        <WidgetEmpty
          hint={t(
            "pier.codex.widget.noUsageHint",
            "Usage will appear after the next refresh."
          )}
          title={t("pier.codex.widget.noUsageData", "No usage data")}
        />
        <AccountPicker context={context} snapshot={snapshot} t={t} />
      </div>
    );
  }

  const fetchedLabel = formatRelativeTime(
    usage.fetchedAt,
    Date.now(),
    context.i18n.language()
  );

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-3 p-3 text-sm"
      data-slot="codex-accounts-widget"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted">
            <Orbit
              aria-hidden="true"
              className="size-4 text-muted-foreground"
            />
          </span>
          <div className="min-w-0">
            <p className="font-medium text-sm">Codex</p>
            <p className="@min-[340px]:hidden truncate text-[11px] text-muted-foreground">
              {fetchedLabel}
            </p>
          </div>
        </div>
        <span className="@min-[340px]:block hidden text-muted-foreground text-xs tabular-nums">
          {fetchedLabel}
        </span>
      </div>

      {/* Usage meters */}
      <UsageMeter
        language={context.i18n.language()}
        session={usage.session}
        t={t}
        weekly={usage.weekly}
      />

      {/* Account picker */}
      <AccountPicker context={context} snapshot={snapshot} t={t} />
    </div>
  );
}
