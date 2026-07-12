import type {
  ExternalRendererPluginContext,
  MissionControlWidgetComponentProps,
} from "@pier/plugin-api/renderer";
import { formatRelativeTime } from "@pier/ui/format.tsx";
import { Spinner } from "@pier/ui/spinner.tsx";
import {
  WidgetEmpty,
  WidgetError,
  WidgetSkeleton,
} from "@pier/ui/widget-state.tsx";
import { ChartNoAxesColumnIncreasing } from "lucide-react";
import type { JSX } from "react";
import { useEffect, useRef, useState } from "react";
import {
  CostDataQualityBadge,
  CostUsageVisualization,
} from "./cost-usage-visualization.tsx";
import { useCodexAccountsSnapshot } from "./use-accounts-snapshot.ts";

export interface CostWidgetProps extends MissionControlWidgetComponentProps {
  context: ExternalRendererPluginContext;
}

export function CostWidget({
  context,
  refreshToken,
  visible,
}: CostWidgetProps): JSX.Element {
  const { error: loadError, snapshot } = useCodexAccountsSnapshot(context);
  const previousRefresh = useRef(refreshToken);
  const refreshRequestId = useRef(0);
  const [refreshing, setRefreshing] = useState(false);
  const t = (key: string, fallback: string): string =>
    context.i18n.t(key, fallback);

  useEffect(() => {
    if (!visible) {
      refreshRequestId.current += 1;
      setRefreshing(false);
      return;
    }
    if (refreshToken === previousRefresh.current) return;
    previousRefresh.current = refreshToken;
    const requestId = ++refreshRequestId.current;
    setRefreshing(true);
    context.rpc
      .invoke("usage.refreshCost", null)
      .then(() => {
        context.notifications.success(
          context.i18n.t(
            "pier.codex.accounts.settings.costRefreshSuccess",
            "Cost data refreshed"
          )
        );
      })
      .catch((error: unknown) => {
        context.dialogs
          .alert({
            body: error instanceof Error ? error.message : String(error),
            title: context.i18n.t(
              "pier.codex.accounts.settings.costRefreshFailed",
              "Could not refresh cost data"
            ),
          })
          .catch(() => undefined);
      })
      .finally(() => {
        if (refreshRequestId.current === requestId) setRefreshing(false);
      });
    return () => {
      if (refreshRequestId.current === requestId) {
        refreshRequestId.current += 1;
      }
    };
  }, [context, refreshToken, visible]);

  if (loadError) {
    return (
      <WidgetError message={loadError}>
        {t("pier.codex.widget.costLoadFailed", "Could not load Codex cost")}
      </WidgetError>
    );
  }
  if (!snapshot) return <WidgetSkeleton />;
  if (!snapshot.costUsage) {
    return (
      <WidgetEmpty
        hint={t(
          "pier.codex.widget.noCostHint",
          "Cost appears after local Codex sessions are scanned."
        )}
        icon={ChartNoAxesColumnIncreasing}
        title={t("pier.codex.widget.noCostData", "No cost data")}
      />
    );
  }

  return (
    <div
      className="pier-codex-cost-widget flex h-full min-h-0 flex-col gap-3 p-(--card-spacing)"
      data-slot="codex-cost-widget"
    >
      <div className="@[34rem]:flex hidden min-h-5 justify-end">
        <CostDataQualityBadge snapshot={snapshot.costUsage} t={t} />
      </div>
      <CostUsageVisualization
        language={context.i18n.language()}
        snapshot={snapshot.costUsage}
        t={t}
      />
      <div
        aria-live="polite"
        className="flex min-h-4 items-center justify-end gap-1 text-muted-foreground text-xs tabular-nums"
      >
        {refreshing ? (
          <>
            <Spinner
              aria-label={t("pier.codex.widget.refreshing", "Refreshing")}
              className="motion-reduce:animate-none"
            />
            <span>{t("pier.codex.widget.refreshing", "Refreshing")}</span>
          </>
        ) : (
          <span>
            {t("pier.codex.accounts.settings.updated", "Updated")}{" "}
            {formatRelativeTime(
              snapshot.costUsage.observedAt,
              Date.now(),
              context.i18n.language()
            )}
          </span>
        )}
      </div>
    </div>
  );
}
