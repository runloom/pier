import { type ChartConfig, ChartContainer } from "@pier/ui/chart.tsx";
import { formatBytes, formatPercent } from "@pier/ui/format.tsx";
import { Progress } from "@pier/ui/progress.tsx";
import { WidgetError, WidgetSkeleton } from "@pier/ui/widget-state.tsx";
import type { MissionControlWidgetComponentProps } from "@plugins/api/renderer.ts";
import i18next from "i18next";
import { useEffect, useRef } from "react";
import { Area, AreaChart } from "recharts";
import { useT } from "@/i18n/use-t.ts";
import {
  acquireSystemStatsPolling,
  pollSystemStatsOnce,
  useSystemStatsStore,
} from "@/stores/system-stats.store.ts";

const CPU_CHART_CONFIG = {
  value: { color: "var(--chart-1)" },
} satisfies ChartConfig;

function MeterTile({
  detail,
  label,
  ratio,
  value,
}: {
  detail?: string;
  label: string;
  ratio: number | null;
  value: string;
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-muted-foreground text-xs">{label}</span>
        {detail ? (
          <span className="truncate text-muted-foreground text-xs tabular-nums">
            {detail}
          </span>
        ) : null}
      </div>
      <p className="font-semibold text-lg tabular-nums leading-tight">
        {value}
      </p>
      {ratio === null ? null : <Progress className="h-1" value={ratio * 100} />}
    </div>
  );
}

/**
 * 系统资源物料：CPU / 内存 / 负载 / Pier 自身内存。
 * 拉取式 2s 轮询，面板可见才 acquire（协议红线：不可见必须停表）；
 * refreshToken 变化时立即补采一次，不等待下一拍。
 * 数据全部来自 main 侧 os.* 真实采样，零外部依赖。
 */
export function SystemResourcesWidget({
  refreshToken,
  size,
  visible,
}: MissionControlWidgetComponentProps) {
  const t = useT();
  const locale = i18next.language || "en";
  const previousRefreshTokenRef = useRef(refreshToken);

  useEffect(() => {
    if (!visible) {
      return;
    }
    return acquireSystemStatsPolling();
  }, [visible]);

  useEffect(() => {
    if (previousRefreshTokenRef.current === refreshToken) {
      return;
    }
    previousRefreshTokenRef.current = refreshToken;
    if (visible) {
      // pollSystemStatsOnce 内部负责错误落态，不会产生未处理 rejection。
      pollSystemStatsOnce();
    }
  }, [refreshToken, visible]);

  const snapshot = useSystemStatsStore((s) => s.snapshot);
  const error = useSystemStatsStore((s) => s.error);
  const cpuHistory = useSystemStatsStore((s) => s.cpuHistory);

  if (snapshot === null && error) {
    return (
      <WidgetError
        message={t("missionControl.widget.systemResources.error")}
        onRetry={() => {
          pollSystemStatsOnce().catch(() => undefined);
        }}
        retryLabel={t("missionControl.widget.retry")}
      />
    );
  }
  if (snapshot === null) {
    return <WidgetSkeleton />;
  }

  const memoryUsed = snapshot.memoryTotal - snapshot.memoryFree;
  const memoryRatio = memoryUsed / snapshot.memoryTotal;
  const showTrend = size.h >= 4 && cpuHistory.length >= 2;

  return (
    <div className="flex min-h-full flex-col gap-2 p-3">
      <div
        className="grid @[14rem]:grid-cols-2 grid-cols-1 gap-2"
        data-testid="system-resources-grid"
      >
        <MeterTile
          detail={t("missionControl.widget.systemResources.cores").replace(
            "{{count}}",
            String(snapshot.cpuCount)
          )}
          label={t("missionControl.widget.systemResources.cpu")}
          ratio={snapshot.cpuUsage}
          value={
            snapshot.cpuUsage === null
              ? "—"
              : formatPercent(snapshot.cpuUsage, locale)
          }
        />
        <MeterTile
          detail={formatBytes(snapshot.memoryTotal, locale)}
          label={t("missionControl.widget.systemResources.memory")}
          ratio={memoryRatio}
          value={formatBytes(memoryUsed, locale)}
        />
        <MeterTile
          label={t("missionControl.widget.systemResources.load")}
          ratio={null}
          value={`${snapshot.loadAvg1.toFixed(1)} · ${snapshot.loadAvg5.toFixed(1)} · ${snapshot.loadAvg15.toFixed(1)}`}
        />
        <MeterTile
          label={t("missionControl.widget.systemResources.appMemory")}
          ratio={null}
          value={formatBytes(snapshot.appMemoryRss, locale)}
        />
      </div>
      {showTrend ? (
        <div className="flex min-h-0 flex-1 flex-col gap-1 rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
          <span className="text-muted-foreground text-xs">
            {t("missionControl.widget.systemResources.cpuTrend")}
          </span>
          <ChartContainer
            className="aspect-auto min-h-12 w-full flex-1"
            config={CPU_CHART_CONFIG}
          >
            <AreaChart
              data={cpuHistory as { ts: number; value: number }[]}
              margin={{ bottom: 2, left: 0, right: 0, top: 2 }}
            >
              <Area
                dataKey="value"
                fill="var(--color-value)"
                fillOpacity={0.15}
                isAnimationActive={false}
                stroke="var(--color-value)"
                strokeWidth={1.5}
                type="monotone"
              />
            </AreaChart>
          </ChartContainer>
        </div>
      ) : null}
    </div>
  );
}
