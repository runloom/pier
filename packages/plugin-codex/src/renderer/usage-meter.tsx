import { formatDurationShort, formatPercent } from "@pier/ui/format.tsx";
import { Progress } from "@pier/ui/progress.tsx";
import { cn } from "@pier/ui/utils";
import { WidgetEmpty } from "@pier/ui/widget-state.tsx";
import type { JSX } from "react";
import type { CodexUsageWindow } from "../shared/accounts.ts";
import {
  remainingPercent,
  type UsageRisk,
  usageRisk,
} from "../shared/usage.ts";

export type Translate = (key: string, fallback: string) => string;

export interface UsageProgressProps {
  label: string;
  language: string;
  showLabel?: boolean;
  t: Translate;
  window: CodexUsageWindow;
}

function resetsLabel(
  window: CodexUsageWindow,
  now: number,
  language: string
): string | null {
  if (!window.resetsAt || window.resetsAt <= now) return null;
  return formatDurationShort(window.resetsAt - now, language);
}

function progressVariant(
  risk: UsageRisk
): "default" | "destructive" | "warning" {
  if (risk === "critical") return "destructive";
  if (risk === "warning") return "warning";
  return "default";
}

function riskLabel(risk: UsageRisk, t: Translate): string {
  if (risk === "critical") {
    return t("pier.codex.usage.risk.critical", "Critical");
  }
  if (risk === "warning") {
    return t("pier.codex.usage.risk.warning", "Warning");
  }
  return t("pier.codex.usage.risk.normal", "Normal");
}

export function UsageProgress({
  label,
  language,
  showLabel = true,
  t,
  window,
}: UsageProgressProps): JSX.Element {
  const remaining = remainingPercent(window.usedPercent);
  const remainingLabel = formatPercent(remaining / 100, language);
  const risk = usageRisk(window.usedPercent);
  const reset = resetsLabel(window, Date.now(), language);

  return (
    <div
      className="pier-codex-usage-progress"
      data-risk={risk}
      data-slot="codex-usage-progress"
    >
      <div className="pier-codex-usage-progress-heading">
        {showLabel ? (
          <span className="font-medium text-xs">{label}</span>
        ) : null}
        <span className="text-xs tabular-nums">
          {remainingLabel}
          {risk === "normal" ? null : (
            <span className="text-muted-foreground">
              {" "}
              · {riskLabel(risk, t)}
            </span>
          )}
        </span>
      </div>
      <Progress
        aria-label={`${label}: ${t("pier.codex.widget.remaining", "remaining")} ${remainingLabel}, ${riskLabel(risk, t)}`}
        className="h-1.5"
        value={remaining}
        variant={progressVariant(risk)}
      />
      {reset ? (
        <div className="pier-codex-usage-progress-meta">
          {t("pier.codex.widget.resetsIn", "Resets in")} {reset}
        </div>
      ) : null}
    </div>
  );
}

export interface UsageMeterProps {
  className?: string;
  language: string;
  session?: CodexUsageWindow | undefined;
  t: Translate;
  weekly?: CodexUsageWindow | undefined;
}

export function UsageMeter({
  className,
  language,
  session,
  t,
  weekly,
}: UsageMeterProps): JSX.Element {
  if (!(session || weekly)) {
    return (
      <WidgetEmpty
        title={t("pier.codex.widget.noUsage", "No usage data available yet.")}
      />
    );
  }

  return (
    <div
      className={cn("pier-codex-usage-meter", className)}
      data-slot="codex-usage-meter"
    >
      {session ? (
        <UsageProgress
          label={t("pier.codex.widget.session", "Session")}
          language={language}
          t={t}
          window={session}
        />
      ) : null}
      {weekly ? (
        <UsageProgress
          label={t("pier.codex.widget.weekly", "Weekly")}
          language={language}
          t={t}
          window={weekly}
        />
      ) : null}
    </div>
  );
}
