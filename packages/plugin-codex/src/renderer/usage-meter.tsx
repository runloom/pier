import { formatDurationShort } from "@pier/ui/format.tsx";
import { WidgetEmpty } from "@pier/ui/widget-state.tsx";
import type { JSX } from "react";
import type { CodexUsageWindow } from "../shared/accounts.ts";
import { remainingPercent } from "../shared/usage.ts";

export interface UsageMeterProps {
  session?: CodexUsageWindow | undefined;
  t: (key: string, fallback: string) => string;
  weekly?: CodexUsageWindow | undefined;
}

function resetsLabel(window: CodexUsageWindow, now: number): string | null {
  if (!window.resetsAt || window.resetsAt <= now) return null;
  const ms = window.resetsAt - now;
  return formatDurationShort(ms);
}

export function UsageMeter({
  session,
  t,
  weekly,
}: UsageMeterProps): JSX.Element {
  const hasSession = session !== undefined;
  const hasWeekly = weekly !== undefined;
  const now = Date.now();

  if (!(hasSession || hasWeekly)) {
    return (
      <WidgetEmpty
        title={t("pier.codex.widget.noUsage", "No usage data available yet.")}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {hasSession ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-muted-foreground">
              {t("pier.codex.widget.session", "Session")}
            </span>
            <span className="tabular-nums">
              {remainingPercent(session.usedPercent)}%{" "}
              {t("pier.codex.widget.remaining", "remaining")}
            </span>
          </div>
          {resetsLabel(session, now) ? (
            <p className="text-muted-foreground text-xs">
              {t("pier.codex.widget.resetsIn", "Resets in")}{" "}
              {resetsLabel(session, now)}
            </p>
          ) : null}
        </div>
      ) : null}
      {hasWeekly ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-muted-foreground">
              {t("pier.codex.widget.weekly", "Weekly")}
            </span>
            <span className="tabular-nums">
              {remainingPercent(weekly.usedPercent)}%{" "}
              {t("pier.codex.widget.remaining", "remaining")}
            </span>
          </div>
          {resetsLabel(weekly, now) ? (
            <p className="text-muted-foreground text-xs">
              {t("pier.codex.widget.resetsIn", "Resets in")}{" "}
              {resetsLabel(weekly, now)}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
