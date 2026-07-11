import { Badge } from "@pier/ui/badge.tsx";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@pier/ui/card.tsx";
import { formatCompactNumber, formatCurrency } from "@pier/ui/format.tsx";
import type { CSSProperties, JSX } from "react";
import type { CodexCostUsageSnapshot } from "../shared/accounts.ts";
import type { Translate } from "./usage-meter.tsx";

const COST_DAYS = Array.from(
  { length: 31 },
  (_, index) => `cost-day-${index + 1}`
);

export function CostCard({
  language,
  snapshot,
  t,
}: {
  language: string;
  snapshot: CodexCostUsageSnapshot | null | undefined;
  t: Translate;
}): JSX.Element {
  const costsByDate = new Map(
    (snapshot?.buckets ?? []).map((bucket) => [
      bucket.date,
      bucket.estimatedCostMicrousd,
    ])
  );
  const endDate = snapshot?.coverage.to
    ? new Date(`${snapshot.coverage.to}T00:00:00Z`)
    : new Date();
  const chartBuckets = COST_DAYS.map((_, index) => {
    const date = new Date(endDate);
    date.setUTCDate(endDate.getUTCDate() - (COST_DAYS.length - index - 1));
    const key = date.toISOString().slice(0, 10);
    return { date: key, estimatedCostMicrousd: costsByDate.get(key) ?? null };
  });
  const maxCost = Math.max(
    1,
    ...chartBuckets.map((bucket) => bucket.estimatedCostMicrousd ?? 0)
  );
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
        {snapshot && !snapshot.coverage.complete ? (
          <CardAction>
            <Badge variant="outline">
              {t("pier.codex.accounts.settings.partialData", "Partial data")}
            </Badge>
          </CardAction>
        ) : null}
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
                "Last 31 days cost"
              )}
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
                "Last 31 days tokens"
              )}
            </span>
            <strong>
              {snapshot
                ? formatCompactNumber(snapshot.summary.periodTokens, language)
                : "—"}
            </strong>
          </div>
          <div>
            <span>
              {t("pier.codex.accounts.settings.tokensLatest", "Latest tokens")}
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
        <div
          aria-label={t(
            "pier.codex.accounts.settings.costChart",
            "Daily estimated cost for the last 31 days"
          )}
          className="pier-codex-cost-bars"
          role="img"
        >
          {chartBuckets.map((bucket) => (
            <i
              className={
                bucket.estimatedCostMicrousd === null ? "is-empty" : undefined
              }
              key={bucket.date}
              style={
                {
                  "--pier-cost-height": `${Math.max(5, ((bucket.estimatedCostMicrousd ?? 0) / maxCost) * 100)}%`,
                } as CSSProperties
              }
              title={`${bucket.date} · ${bucket.estimatedCostMicrousd == null ? "—" : formatCurrency(bucket.estimatedCostMicrousd / 1_000_000, language)}`}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
