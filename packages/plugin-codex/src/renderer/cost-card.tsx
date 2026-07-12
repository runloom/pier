import { Badge } from "@pier/ui/badge.tsx";
import { Button } from "@pier/ui/button.tsx";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@pier/ui/card.tsx";
import {
  formatCompactNumber,
  formatCount,
  formatCurrency,
  formatRelativeTime,
} from "@pier/ui/format.tsx";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@pier/ui/tooltip.tsx";
import { cn } from "@pier/ui/utils.ts";
import { RefreshCw } from "lucide-react";
import type { CSSProperties, JSX } from "react";
import type { CodexCostUsageSnapshot } from "../shared/accounts.ts";
import { COST_USAGE_PERIOD_DAYS } from "../shared/constants.ts";
import type { Translate } from "./usage-meter.tsx";

const COST_DAYS = Array.from(
  { length: COST_USAGE_PERIOD_DAYS },
  (_, index) => `cost-day-${index + 1}`
);

export function CostCard({
  language,
  onRefresh,
  refreshing,
  snapshot,
  t,
}: {
  language: string;
  onRefresh: () => void;
  refreshing: boolean;
  snapshot: CodexCostUsageSnapshot | null | undefined;
  t: Translate;
}): JSX.Element {
  const periodDays = formatCount(COST_USAGE_PERIOD_DAYS, language);
  const tokensLabel = t("pier.codex.accounts.settings.chartTokens", "Tokens");
  const bucketsByDate = new Map(
    (snapshot?.buckets ?? []).map((bucket) => [bucket.date, bucket])
  );
  const endDate = snapshot?.coverage.to
    ? new Date(`${snapshot.coverage.to}T00:00:00Z`)
    : new Date();
  const chartBuckets = COST_DAYS.map((_, index) => {
    const date = new Date(endDate);
    date.setUTCDate(endDate.getUTCDate() - (COST_DAYS.length - index - 1));
    const key = date.toISOString().slice(0, 10);
    const bucket = bucketsByDate.get(key);
    return {
      date: key,
      estimatedCostMicrousd: bucket?.estimatedCostMicrousd ?? null,
      tokens: bucket?.tokens.totalTokens ?? null,
    };
  });
  const maxCost = Math.max(
    1,
    ...chartBuckets.map((bucket) => bucket.estimatedCostMicrousd ?? 0)
  );
  const unpricedDays =
    snapshot?.buckets.filter((bucket) => bucket.pricingStatus !== "complete")
      .length ?? 0;
  const diagnostics = snapshot?.diagnostics;
  const incompleteCoverage = Boolean(snapshot && !snapshot.coverage.complete);
  const partiallyUnpriced = Boolean(snapshot && unpricedDays > 0);
  const showDataQualityBadge = incompleteCoverage || partiallyUnpriced;
  const diagnosticMessages = [
    diagnostics?.failedFiles
      ? t(
          "pier.codex.accounts.settings.costFailedFiles",
          "{count} files could not be read"
        ).replace("{count}", String(diagnostics.failedFiles))
      : null,
    diagnostics?.malformedLines
      ? t(
          "pier.codex.accounts.settings.costMalformedLines",
          "{count} malformed log lines were ignored"
        ).replace("{count}", String(diagnostics.malformedLines))
      : null,
    diagnostics?.truncatedFiles
      ? t(
          "pier.codex.accounts.settings.costTruncatedFiles",
          "{count} files exceeded the scan limit"
        ).replace("{count}", String(diagnostics.truncatedFiles))
      : null,
    unpricedDays > 0
      ? t(
          "pier.codex.accounts.settings.costUnpricedDays",
          "{count} days contain models without pricing"
        ).replace("{count}", String(unpricedDays))
      : null,
  ].filter((message) => message !== null);
  const latestDate = snapshot?.buckets.at(-1)?.date;
  return (
    <Card data-testid="codex-cost-card" size="sm">
      <CardHeader>
        <CardTitle>{t("pier.codex.accounts.settings.cost", "Cost")}</CardTitle>
        <CardDescription>
          {t(
            "pier.codex.accounts.settings.costEstimateNote",
            "Estimated API-equivalent cost from local Codex session logs"
          )}
        </CardDescription>
        <CardAction className="flex items-center gap-1">
          <TooltipProvider delayDuration={200}>
            {showDataQualityBadge ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge role="status" tabIndex={0} variant="outline">
                    {incompleteCoverage
                      ? t(
                          "pier.codex.accounts.settings.partialData",
                          "Partial data"
                        )
                      : t(
                          "pier.codex.accounts.settings.partiallyUnpriced",
                          "Some cost is unpriced"
                        )}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent className="max-w-96">
                  {diagnosticMessages.join(" · ") ||
                    t(
                      "pier.codex.accounts.settings.partialDataUnknown",
                      "Some local usage could not be included"
                    )}
                </TooltipContent>
              </Tooltip>
            ) : null}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-busy={refreshing || undefined}
                  aria-label={t(
                    "pier.codex.accounts.settings.refreshCost",
                    "Refresh cost"
                  )}
                  disabled={refreshing}
                  onClick={onRefresh}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <RefreshCw
                    className={cn(
                      refreshing && "animate-spin motion-reduce:animate-none"
                    )}
                    data-icon="inline-start"
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {t("pier.codex.accounts.settings.refreshCost", "Refresh cost")}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="pier-codex-cost-metrics">
          <div>
            <span>{t("pier.codex.accounts.settings.costToday", "Today")}</span>
            <strong>
              {snapshot?.summary.todayEstimatedCostMicrousd == null
                ? "—"
                : formatCurrency(
                    snapshot.summary.todayEstimatedCostMicrousd / 1_000_000,
                    language
                  )}
            </strong>
          </div>
          <div>
            <span>
              {t(
                "pier.codex.accounts.settings.costPeriod",
                "Last {count} days cost"
              ).replace("{count}", periodDays)}
            </span>
            <strong>
              {snapshot?.summary.estimatedCostMicrousd == null
                ? "—"
                : formatCurrency(
                    snapshot.summary.estimatedCostMicrousd / 1_000_000,
                    language
                  )}
            </strong>
          </div>
          <div>
            <span>
              {t(
                "pier.codex.accounts.settings.tokensPeriod",
                "Last {count} days tokens"
              ).replace("{count}", periodDays)}
            </span>
            <strong>
              {snapshot
                ? formatCompactNumber(snapshot.summary.periodTokens, language)
                : "—"}
            </strong>
          </div>
          <div>
            <span>
              {t(
                "pier.codex.accounts.settings.tokensLatest",
                "Latest active day tokens"
              )}
              {latestDate ? ` · ${latestDate}` : ""}
            </span>
            <strong>
              {snapshot
                ? formatCompactNumber(
                    snapshot.summary.latestDayTokens,
                    language
                  )
                : "—"}
            </strong>
          </div>
        </div>
        <TooltipProvider delayDuration={100}>
          <figure
            aria-label={t(
              "pier.codex.accounts.settings.costChart",
              "Daily estimated cost for the last {count} days"
            ).replace("{count}", periodDays)}
            className="pier-codex-cost-bars"
          >
            {chartBuckets.map((bucket) => {
              const cost =
                bucket.estimatedCostMicrousd === null
                  ? t(
                      "pier.codex.accounts.settings.costUnavailable",
                      "Not priced"
                    )
                  : formatCurrency(
                      bucket.estimatedCostMicrousd / 1_000_000,
                      language
                    );
              const tokens =
                bucket.tokens === null
                  ? "—"
                  : formatCompactNumber(bucket.tokens, language);
              const label = `${bucket.date} · ${cost} · ${tokens} ${tokensLabel}`;
              return (
                <Tooltip key={bucket.date}>
                  <TooltipTrigger asChild>
                    <button
                      aria-label={label}
                      className={
                        bucket.estimatedCostMicrousd === null
                          ? "is-empty"
                          : undefined
                      }
                      data-cost-bar
                      style={
                        {
                          "--pier-cost-height": `${Math.max(5, ((bucket.estimatedCostMicrousd ?? 0) / maxCost) * 100)}%`,
                        } as CSSProperties
                      }
                      type="button"
                    />
                  </TooltipTrigger>
                  <TooltipContent>
                    <div className="flex flex-col gap-1">
                      <strong>{bucket.date}</strong>
                      <span>
                        {t("pier.codex.accounts.settings.chartCost", "Cost")}:{" "}
                        {cost}
                      </span>
                      <span>
                        {tokensLabel}: {tokens}
                      </span>
                    </div>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </figure>
        </TooltipProvider>
      </CardContent>
      <CardFooter>
        <span className="pier-codex-updated-at">
          {snapshot
            ? `${t("pier.codex.accounts.settings.updated", "Updated")} ${formatRelativeTime(snapshot.observedAt, Date.now(), language)}`
            : ""}
        </span>
      </CardFooter>
    </Card>
  );
}
