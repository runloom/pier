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
import { formatRelativeTime } from "@pier/ui/format.tsx";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@pier/ui/tooltip.tsx";
import { cn } from "@pier/ui/utils.ts";
import { RefreshCw } from "lucide-react";
import type { JSX } from "react";
import type { CodexCostUsageSnapshot } from "../shared/accounts.ts";
import {
  CostDataQualityBadge,
  CostUsageVisualization,
} from "./cost-usage-visualization.tsx";
import type { Translate } from "./usage-meter.tsx";

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
          <CostDataQualityBadge snapshot={snapshot} t={t} />
          <TooltipProvider delayDuration={200}>
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
              <TooltipContent data-pier-codex-scope="">
                {t("pier.codex.accounts.settings.refreshCost", "Refresh cost")}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </CardAction>
      </CardHeader>
      <CardContent>
        <CostUsageVisualization
          language={language}
          presentation="settings"
          snapshot={snapshot}
          t={t}
        />
      </CardContent>
      {snapshot ? (
        <CardFooter>
          <span className="text-muted-foreground text-xs tabular-nums">
            {`${t("pier.codex.accounts.settings.updated", "Updated")} ${formatRelativeTime(snapshot.observedAt, Date.now(), language)}`}
          </span>
        </CardFooter>
      ) : null}
    </Card>
  );
}
