import type { ForegroundActivity } from "@shared/contracts/foreground-activity.ts";
import type { UsageAggregateSnapshot } from "@shared/contracts/usage-data.ts";
import { activityKindCounts } from "@shared/task-activity-sources.ts";
import i18next from "i18next";
import {
  activityCounts,
  useForegroundActivityStore,
} from "@/stores/foreground-activity.store.ts";
import {
  acquirePierResourcePolling,
  usePierResourceStore,
} from "@/stores/pier-resource.store.ts";
import { useTaskRunsStore } from "@/stores/task-runs.store.ts";
import { useUsageDataStore } from "@/stores/usage-data.store.ts";
import type { MetricValue } from "./metric-registry.ts";
import { registerMetric } from "./metric-registry.ts";

/**
 * core 指标接线：活动域（push，foreground-activity store 驱动）+
 * Pier 资源域（pull，订阅时 acquire 轮询、退订即停表）。
 * 幂等注册——首个消费方 import 即生效。
 */

function activityInstant(
  select: (activities: Record<string, ForegroundActivity>) => number
): { read(): MetricValue; subscribe(listener: () => void): () => void } {
  return {
    read: () => ({
      kind: "instant",
      value: select(useForegroundActivityStore.getState().activities),
    }),
    subscribe: (listener) => useForegroundActivityStore.subscribe(listener),
  };
}

function combinedActivityInstant(
  select: (
    activities: Record<string, ForegroundActivity>,
    taskRuns: ReturnType<typeof useTaskRunsStore.getState>["snapshot"]
  ) => number
): { read(): MetricValue; subscribe(listener: () => void): () => void } {
  return {
    read: () => ({
      kind: "instant",
      value: select(
        useForegroundActivityStore.getState().activities,
        useTaskRunsStore.getState().snapshot
      ),
    }),
    subscribe: (listener) => {
      const unsubActivity = useForegroundActivityStore.subscribe(listener);
      const unsubRuns = useTaskRunsStore.subscribe(listener);
      return () => {
        unsubActivity();
        unsubRuns();
      };
    },
  };
}

function activityByKind(): MetricValue {
  const counts = activityKindCounts(
    useForegroundActivityStore.getState().activities,
    useTaskRunsStore.getState().snapshot
  );
  return {
    items: Array.from(counts.entries())
      .map(([kind, value]) => ({
        label: i18next.t(`workbench.widget.activityOverview.kind.${kind}`),
        value,
      }))
      .sort((a, b) => b.value - a.value),
    kind: "grouped",
  };
}

function pierResourceSubscribe(listener: () => void): () => void {
  const release = acquirePierResourcePolling();
  const unsubscribe = usePierResourceStore.subscribe(listener);
  return () => {
    unsubscribe();
    release();
  };
}

function pierResourceInstant(
  select: (
    snapshot: NonNullable<
      ReturnType<typeof usePierResourceStore.getState>["snapshot"]
    >
  ) => number | null
): { read(): MetricValue; subscribe(listener: () => void): () => void } {
  return {
    read: () => {
      const snapshot = usePierResourceStore.getState().snapshot;
      return {
        kind: "instant",
        value: snapshot === null ? null : select(snapshot),
      };
    },
    subscribe: pierResourceSubscribe,
  };
}

function usageInstant(
  select: (snapshot: UsageAggregateSnapshot) => number | null
): { read(): MetricValue; subscribe(listener: () => void): () => void } {
  return {
    read: () => {
      const snapshot = useUsageDataStore.getState().snapshot;
      return {
        kind: "instant",
        value: snapshot === null ? null : select(snapshot),
      };
    },
    subscribe: (listener) => useUsageDataStore.subscribe(listener),
  };
}

const MICROUSD_PER_USD = 1_000_000;

function costMicrousdToUsd(microusd: number | null): number | null {
  return microusd === null ? null : microusd / MICROUSD_PER_USD;
}

function costDailySeries(): MetricValue {
  const snapshot = useUsageDataStore.getState().snapshot;
  if (snapshot === null) return { kind: "series", points: [] };
  const points = snapshot.overall.buckets.flatMap((bucket) => {
    if (bucket.estimatedCostMicrousd === null) return [];
    // 用 UTC 中午避免 timezone 偏移把日期挪到相邻天
    const ts = Date.parse(`${bucket.date}T12:00:00Z`);
    return Number.isFinite(ts)
      ? [{ ts, value: bucket.estimatedCostMicrousd / MICROUSD_PER_USD }]
      : [];
  });
  return { kind: "series", points };
}

function groupedCostItems<T>(
  rows: readonly T[],
  extract: (row: T) => { cost: number | null; label: string }
): MetricValue {
  const items = rows
    .flatMap((row) => {
      const { cost, label } = extract(row);
      return cost === null ? [] : [{ label, value: cost / MICROUSD_PER_USD }];
    })
    .sort((a, b) => b.value - a.value);
  return { items, kind: "grouped" };
}

function costByModel(): MetricValue {
  const snapshot = useUsageDataStore.getState().snapshot;
  if (snapshot === null) return { items: [], kind: "grouped" };
  return groupedCostItems(snapshot.overall.summary.byModel, (row) => ({
    cost: row.estimatedCostMicrousd,
    label: row.modelId || i18next.t("workbench.metrics.unknown"),
  }));
}

function costBySource(): MetricValue {
  const snapshot = useUsageDataStore.getState().snapshot;
  if (snapshot === null) return { items: [], kind: "grouped" };
  return groupedCostItems(snapshot.sources, (source) => ({
    cost: source.snapshot.summary.estimatedCostMicrousd,
    label: `${source.pluginId}/${source.sourceId}`,
  }));
}

let registered = false;

/** 测试用重置：与 `clearMetricsForTests` 配对使用，重放注册幂等守卫。 */
export function resetCoreMetricsForTests(): void {
  registered = false;
}

export function ensureCoreMetricsRegistered(): void {
  if (registered) {
    return;
  }
  registered = true;

  registerMetric({
    descriptor: {
      format: "count",
      id: "core.activity.total",
      kind: "instant",
      titleKey: "workbench.metrics.activityTotal",
    },
    ...activityInstant((activities) => Object.keys(activities).length),
  });
  registerMetric({
    descriptor: {
      format: "count",
      id: "core.activity.running",
      kind: "instant",
      titleKey: "workbench.metrics.activityRunning",
    },
    ...combinedActivityInstant(
      (activities, taskRuns) => activityCounts(activities, taskRuns).running
    ),
  });
  registerMetric({
    descriptor: {
      format: "count",
      id: "core.activity.waiting",
      kind: "instant",
      titleKey: "workbench.metrics.activityWaiting",
    },
    ...combinedActivityInstant(
      (activities, taskRuns) => activityCounts(activities, taskRuns).waiting
    ),
  });
  registerMetric({
    descriptor: {
      format: "count",
      id: "core.activity.byKind",
      kind: "grouped",
      titleKey: "workbench.metrics.activityByKind",
    },
    read: activityByKind,
    subscribe: (listener) => {
      const unsubActivity = useForegroundActivityStore.subscribe(listener);
      const unsubRuns = useTaskRunsStore.subscribe(listener);
      return () => {
        unsubActivity();
        unsubRuns();
      };
    },
  });

  registerMetric({
    descriptor: {
      format: "bytes",
      id: "core.pier.totalMemory",
      kind: "instant",
      titleKey: "workbench.metrics.pierTotalMemory",
    },
    ...pierResourceInstant(
      (snapshot) => snapshot.summary.totalRelatedMemoryBytes
    ),
  });
  registerMetric({
    descriptor: {
      format: "percent",
      id: "core.pier.totalCpu",
      kind: "instant",
      titleKey: "workbench.metrics.pierTotalCpu",
    },
    ...pierResourceInstant(
      (snapshot) => snapshot.summary.totalRelatedCpuPercent
    ),
  });
  registerMetric({
    descriptor: {
      format: "percent",
      id: "core.pier.totalCpuHistory",
      kind: "series",
      titleKey: "workbench.metrics.pierTotalCpuHistory",
    },
    read: () => ({
      kind: "series",
      points: usePierResourceStore.getState().cpuHistory,
    }),
    subscribe: pierResourceSubscribe,
  });
  registerMetric({
    descriptor: {
      format: "bytes",
      id: "core.pier.appMemory",
      kind: "instant",
      titleKey: "workbench.metrics.pierAppMemory",
    },
    ...pierResourceInstant((snapshot) => snapshot.summary.pierAppMemoryBytes),
  });
  registerMetric({
    descriptor: {
      format: "bytes",
      id: "core.pier.workloadMemory",
      kind: "instant",
      titleKey: "workbench.metrics.pierWorkloadMemory",
    },
    ...pierResourceInstant((snapshot) => snapshot.summary.workloadMemoryBytes),
  });
  registerMetric({
    descriptor: {
      format: "count",
      id: "core.pier.terminalCount",
      kind: "instant",
      titleKey: "workbench.metrics.pierTerminalCount",
    },
    ...pierResourceInstant((snapshot) => snapshot.summary.terminalCount),
  });
  registerMetric({
    descriptor: {
      format: "count",
      id: "core.pier.hotCount",
      kind: "instant",
      titleKey: "workbench.metrics.pierHotCount",
    },
    ...pierResourceInstant((snapshot) => snapshot.summary.hotCount),
  });

  registerMetric({
    descriptor: {
      format: "decimal",
      id: "core.cost.today",
      kind: "instant",
      titleKey: "workbench.metrics.costToday",
    },
    ...usageInstant((snapshot) =>
      costMicrousdToUsd(snapshot.overall.summary.todayEstimatedCostMicrousd)
    ),
  });
  registerMetric({
    descriptor: {
      format: "decimal",
      id: "core.cost.periodInstant",
      kind: "instant",
      titleKey: "workbench.metrics.costPeriod",
    },
    ...usageInstant((snapshot) =>
      costMicrousdToUsd(snapshot.overall.summary.estimatedCostMicrousd)
    ),
  });
  registerMetric({
    descriptor: {
      format: "compactNumber",
      id: "core.cost.periodTokens",
      kind: "instant",
      titleKey: "workbench.metrics.costPeriodTokens",
    },
    ...usageInstant((snapshot) => snapshot.overall.summary.periodTokens),
  });
  registerMetric({
    descriptor: {
      format: "decimal",
      id: "core.cost.dailySeries",
      kind: "series",
      titleKey: "workbench.metrics.costDailySeries",
    },
    read: costDailySeries,
    subscribe: (listener) => useUsageDataStore.subscribe(listener),
  });
  registerMetric({
    descriptor: {
      format: "decimal",
      id: "core.cost.byModel",
      kind: "grouped",
      titleKey: "workbench.metrics.costByModel",
    },
    read: costByModel,
    subscribe: (listener) => useUsageDataStore.subscribe(listener),
  });
  registerMetric({
    descriptor: {
      format: "decimal",
      id: "core.cost.bySource",
      kind: "grouped",
      titleKey: "workbench.metrics.costBySource",
    },
    read: costBySource,
    subscribe: (listener) => useUsageDataStore.subscribe(listener),
  });
}
