import { Progress } from "@pier/ui/progress.tsx";
import type { RateLimitWindow } from "@shared/contracts/agent-accounts.ts";

/** 与 RendererPluginContext["i18n"]["t"] 同形；模块级组件经 prop 下传拿到宿主 i18n。 */
export type PluginT = (
  key: string,
  values?: Record<string, number | string>,
  fallback?: string
) => string;

/**
 * 用量 meter：填充色承载严重度（primary → warning → destructive），未填充轨道
 * 用同色浅阶（而非中性灰），百分比文字随严重度同步换色。
 */
export function UsageBar({
  barId,
  error,
  label,
  resetText,
  usage,
}: {
  /** 稳定 testid 段（"session"/"weekly"），与显示用 label 解耦以免翻译破坏测试锚点。 */
  barId: string;
  error?: string | undefined;
  label: string;
  resetText?: string | undefined;
  usage?: RateLimitWindow | undefined;
}): React.ReactElement {
  if (error) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-xs">
        <span>{label}:</span>
        <span className="text-destructive">{error}</span>
      </div>
    );
  }
  if (!usage) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-xs">
        <span>{label}:</span>
        <span>—</span>
      </div>
    );
  }
  // usedPercent 契约即 0-100（29 = 29%），不做二次换算。
  const percent = Math.round(usage.usedPercent);
  let indicatorClass = "";
  let trackClass = "bg-primary/15";
  let percentClass = "text-muted-foreground";
  if (percent >= 90) {
    indicatorClass = "[&>*]:bg-destructive";
    trackClass = "bg-destructive/15";
    percentClass = "font-medium text-destructive";
  } else if (percent >= 70) {
    indicatorClass = "[&>*]:bg-warning";
    trackClass = "bg-warning/15";
    percentClass = "font-medium text-warning";
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={`tabular-nums ${percentClass}`}>{percent}%</span>
      </div>
      <Progress
        className={`h-1.5 ${trackClass} ${indicatorClass}`}
        data-testid={`usage-bar-${barId}`}
        value={Math.min(percent, 100)}
      />
      {resetText && (
        <p className="text-muted-foreground text-xs">{resetText}</p>
      )}
    </div>
  );
}

/** 距 resetsAt 的时长文案片段（"4h 50m" / "3m"）；已过期返回 null。 */
function formatDuration(resetsAt: number): string | null {
  const diff = resetsAt - Date.now();
  if (diff <= 0) {
    return null;
  }
  const hours = Math.floor(diff / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function resetTextFor(
  t: PluginT,
  usage: RateLimitWindow | undefined
): string | undefined {
  if (usage?.resetsAt == null) {
    return;
  }
  const duration = formatDuration(usage.resetsAt);
  if (duration === null) {
    return t("widget.accounts.resetsSoon", undefined, "Resets soon");
  }
  return t(
    "widget.accounts.resetsIn",
    { time: duration },
    `Resets in ${duration}`
  );
}
