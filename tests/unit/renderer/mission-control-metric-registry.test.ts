import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearMetricsForTests,
  getMetricRegistration,
  getMetricRegistryRevision,
  listMetricDescriptors,
  type MetricRegistration,
  registerMetric,
  subscribeMetricRegistry,
} from "@/lib/mission-control/metric-registry.ts";

function makeRegistration(id: string): MetricRegistration {
  return {
    descriptor: {
      format: "count",
      id,
      kind: "instant",
      titleKey: `title.${id}`,
    },
    read: () => ({ kind: "instant", value: 42 }),
    subscribe: () => () => undefined,
  };
}

afterEach(() => {
  clearMetricsForTests();
});

describe("metric registry", () => {
  it("register → get/list，dispose 后移除", () => {
    const dispose = registerMetric(makeRegistration("m1"));
    expect(getMetricRegistration("m1")?.descriptor.id).toBe("m1");
    expect(listMetricDescriptors().map((d) => d.id)).toEqual(["m1"]);

    dispose();
    expect(getMetricRegistration("m1")).toBeUndefined();
    expect(listMetricDescriptors()).toEqual([]);
  });

  it("register/dispose 递增 revision 并通知订阅者", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeMetricRegistry(listener);
    const before = getMetricRegistryRevision();

    const dispose = registerMetric(makeRegistration("m1"));
    expect(getMetricRegistryRevision()).toBe(before + 1);
    expect(listener).toHaveBeenCalledTimes(1);

    dispose();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("同 id 覆盖注册后，旧 dispose 不误删新注册", () => {
    const first = makeRegistration("m1");
    const disposeFirst = registerMetric(first);
    const second = makeRegistration("m1");
    registerMetric(second);

    disposeFirst();
    expect(getMetricRegistration("m1")).toBe(second);
  });
});
