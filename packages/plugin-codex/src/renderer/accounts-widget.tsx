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
  visible: _visible,
}: AccountsWidgetProps): JSX.Element {
  const { error: loadError, snapshot } = useCodexAccountsSnapshot(context);
  const prevRefresh = useRef(refreshToken);
  const t = (key: string, fallback: string): string =>
    context.i18n.t(key, fallback);

  // Refresh usage when refreshToken increments
  useEffect(() => {
    if (refreshToken !== prevRefresh.current) {
      prevRefresh.current = refreshToken;
      context.rpc.invoke("accounts.refreshUsage", null).catch(() => {
        // Silently ignore — the snapshot subscription will pick up changes
      });
    }
  }, [refreshToken, context]);

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
          <span className="font-semibold text-sm">Codex</span>
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
    <div className="flex h-full min-h-0 flex-col gap-3 p-3 text-sm">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="font-semibold text-sm">Codex</span>
        <span className="text-muted-foreground text-xs">{fetchedLabel}</span>
      </div>

      {/* Usage meters */}
      <UsageMeter session={usage.session} t={t} weekly={usage.weekly} />

      {/* Account picker */}
      <AccountPicker context={context} snapshot={snapshot} t={t} />
    </div>
  );
}
