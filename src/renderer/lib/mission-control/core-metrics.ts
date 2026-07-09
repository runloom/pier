import type { ForegroundActivity } from "@shared/contracts/foreground-activity.ts";
import i18next from "i18next";
import {
  activityCounts,
  useForegroundActivityStore,
} from "@/stores/foreground-activity.store.ts";
import {
  acquireSystemStatsPolling,
  useSystemStatsStore,
} from "@/stores/system-stats.store.ts";
import type { MetricValue } from "./metric-registry.ts";
import { registerMetric } from "./metric-registry.ts";

/**
 * core 指标接线：活动域（push，foreground-activity store 驱动）+
 * 系统域（pull，订阅时 acquire 轮询、退订即停表）。
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

function activityByKind(): MetricValue {
  const counts = new Map<ForegroundActivity["kind"], number>();
  const activities = useForegroundActivityStore.getState().activities;
  for (const activity of Object.values(activities)) {
    counts.set(activity.kind, (counts.get(activity.kind) ?? 0) + 1);
  }
  return {
    items: Array.from(counts.entries())
      .map(([kind, value]) => ({
        label: i18next.t(`missionControl.widget.activityOverview.kind.${kind}`),
        value,
      }))
      .sort((a, b) => b.value - a.value),
    kind: "grouped",
  };
}

function systemSubscribe(listener: () => void): () => void {
  const release = acquireSystemStatsPolling();
  const unsubscribe = useSystemStatsStore.subscribe(listener);
  return () => {
    unsubscribe();
    release();
  };
}

function systemInstant(
  select: (
    snapshot: NonNullable<
      ReturnType<typeof useSystemStatsStore.getState>["snapshot"]
    >
  ) => number | null
): { read(): MetricValue; subscribe(listener: () => void): () => void } {
  return {
    read: () => {
      const snapshot = useSystemStatsStore.getState().snapshot;
      return {
        kind: "instant",
        value: snapshot === null ? null : select(snapshot),
      };
    },
    subscribe: systemSubscribe,
  };
}

let registered = false;

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
      titleKey: "missionControl.metrics.activityTotal",
    },
    ...activityInstant((activities) => Object.keys(activities).length),
  });
  registerMetric({
    descriptor: {
      format: "count",
      id: "core.activity.running",
      kind: "instant",
      titleKey: "missionControl.metrics.activityRunning",
    },
    ...activityInstant((activities) => activityCounts(activities).running),
  });
  registerMetric({
    descriptor: {
      format: "count",
      id: "core.activity.waiting",
      kind: "instant",
      titleKey: "missionControl.metrics.activityWaiting",
    },
    ...activityInstant((activities) => activityCounts(activities).waiting),
  });
  registerMetric({
    descriptor: {
      format: "count",
      id: "core.activity.byKind",
      kind: "grouped",
      titleKey: "missionControl.metrics.activityByKind",
    },
    read: activityByKind,
    subscribe: (listener) => useForegroundActivityStore.subscribe(listener),
  });

  registerMetric({
    descriptor: {
      format: "percent",
      id: "core.system.cpu",
      kind: "instant",
      titleKey: "missionControl.metrics.systemCpu",
    },
    ...systemInstant((snapshot) => snapshot.cpuUsage),
  });
  registerMetric({
    descriptor: {
      format: "percent",
      id: "core.system.cpuHistory",
      kind: "series",
      titleKey: "missionControl.metrics.systemCpuHistory",
    },
    read: () => ({
      kind: "series",
      points: useSystemStatsStore.getState().cpuHistory,
    }),
    subscribe: systemSubscribe,
  });
  registerMetric({
    descriptor: {
      format: "bytes",
      id: "core.system.memoryUsed",
      kind: "instant",
      titleKey: "missionControl.metrics.systemMemoryUsed",
    },
    ...systemInstant((snapshot) => snapshot.memoryTotal - snapshot.memoryFree),
  });
  registerMetric({
    descriptor: {
      format: "percent",
      id: "core.system.memoryPercent",
      kind: "instant",
      titleKey: "missionControl.metrics.systemMemoryPercent",
    },
    ...systemInstant(
      (snapshot) =>
        (snapshot.memoryTotal - snapshot.memoryFree) / snapshot.memoryTotal
    ),
  });
  registerMetric({
    descriptor: {
      format: "bytes",
      id: "core.system.appMemory",
      kind: "instant",
      titleKey: "missionControl.metrics.systemAppMemory",
    },
    ...systemInstant((snapshot) => snapshot.appMemoryRss),
  });
  registerMetric({
    descriptor: {
      format: "decimal",
      id: "core.system.load1",
      kind: "instant",
      titleKey: "missionControl.metrics.systemLoad1",
    },
    ...systemInstant((snapshot) => snapshot.loadAvg1),
  });
}
