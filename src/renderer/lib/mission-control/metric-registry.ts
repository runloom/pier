import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

/**
 * 指标目录 —— 自定义组装的数据地基。
 * core 与插件用代码贡献指标（id + 显示元数据 + read/subscribe），
 * 区块物料按 kind 兼容性绑定指标。组装 = 精选区块 × 精选指标的有限组合，
 * 不做查询语言（AGENTS.md 插件纪律边界内的最小承诺面）。
 */

export type MetricFormat =
  | "bytes"
  | "compactNumber"
  | "count"
  | "decimal"
  | "duration"
  | "percent";

export type MetricValue =
  | { items: readonly { label: string; value: number }[]; kind: "grouped" }
  | { kind: "instant"; value: number | null }
  | { kind: "series"; points: readonly { ts: number; value: number }[] };

export type MetricKind = MetricValue["kind"];

export interface MetricDescriptor {
  format: MetricFormat;
  id: string;
  kind: MetricKind;
  /** 宿主 i18next key（core 指标）；插件指标注册时传已本地化字符串亦可。 */
  titleKey: string;
}

export interface MetricRegistration {
  descriptor: MetricDescriptor;
  read(): MetricValue | null;
  /**
   * 订阅值变化；返回退订。数据源的 acquire/release（如系统采样轮询的
   * 引用计数）收敛在 subscribe 内部——有订阅才有数据流。
   */
  subscribe(listener: () => void): () => void;
}

const registrations = new Map<string, MetricRegistration>();
const listeners = new Set<() => void>();
let revision = 0;

function notify(): void {
  revision += 1;
  for (const listener of listeners) {
    listener();
  }
}

export function registerMetric(registration: MetricRegistration): () => void {
  registrations.set(registration.descriptor.id, registration);
  notify();
  return () => {
    if (registrations.get(registration.descriptor.id) === registration) {
      registrations.delete(registration.descriptor.id);
      notify();
    }
  };
}

export function getMetricRegistration(
  id: string
): MetricRegistration | undefined {
  return registrations.get(id);
}

export function listMetricDescriptors(): MetricDescriptor[] {
  return Array.from(registrations.values(), (r) => r.descriptor);
}

export function getMetricRegistryRevision(): number {
  return revision;
}

export function subscribeMetricRegistry(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function clearMetricsForTests(): void {
  registrations.clear();
  notify();
}

/** 指标目录快照（设置面板的指标下拉消费；registry 变化实时重渲）。 */
export function useMetricDescriptors(): MetricDescriptor[] {
  const rev = useSyncExternalStore(
    subscribeMetricRegistry,
    getMetricRegistryRevision,
    getMetricRegistryRevision
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: rev is the registry cache-buster
  return useMemo(() => listMetricDescriptors(), [rev]);
}

/**
 * 订阅单个指标的实时值。`active=false`（面板不可见）时不建立订阅——
 * 数据源的 acquire 随之释放，轮询停表；恢复可见后重新订阅并立即取值。
 */
export function useMetricValue(
  metricId: string,
  active: boolean
): MetricValue | null {
  const rev = useSyncExternalStore(
    subscribeMetricRegistry,
    getMetricRegistryRevision,
    getMetricRegistryRevision
  );
  const [value, setValue] = useState<MetricValue | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: rev is the registry cache-buster
  useEffect(() => {
    const registration = registrations.get(metricId);
    if (!(registration && active)) {
      setValue(registration ? (registration.read() ?? null) : null);
      return;
    }
    setValue(registration.read() ?? null);
    return registration.subscribe(() => {
      setValue(registration.read() ?? null);
    });
  }, [metricId, active, rev]);

  return value;
}
