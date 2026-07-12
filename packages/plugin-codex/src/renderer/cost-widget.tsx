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
  const [refreshing, setRefreshing] = useState(false);
  const t = (key: string, fallback: string): string =>
    context.i18n.t(key, fallback);

  useEffect(() => {
    if (!(visible && refreshToken !== previousRefresh.current)) return;
    previousRefresh.current = refreshToken;
    let cancelled = false;
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
        if (!cancelled) setRefreshing(false);
      });
    return () => {
      cancelled = true;
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
      className="pier-codex-cost-widget codex:flex codex:h-full codex:min-h-0 codex:flex-col codex:gap-3 codex:p-(--card-spacing)"
      data-slot="codex-cost-widget"
    >
      <div className="codex:@[34rem]:flex codex:hidden codex:min-h-5 codex:justify-end">
        <CostDataQualityBadge snapshot={snapshot.costUsage} t={t} />
      </div>
      <CostUsageVisualization
        language={context.i18n.language()}
        snapshot={snapshot.costUsage}
        t={t}
      />
      <div
        aria-live="polite"
        className="pier-codex-tabular-nums codex:flex codex:min-h-4 codex:items-center codex:justify-end codex:gap-1 codex:text-muted-foreground codex:text-xs"
      >
        {refreshing ? (
          <>
            <Spinner
              aria-label={t("pier.codex.widget.refreshing", "Refreshing")}
              className="codex:motion-reduce:animate-none"
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
