import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearMetricsForTests,
  getMetricRegistration,
  getMetricRegistryRevision,
  listMetricDescriptors,
  type MetricRegistration,
  registerMetric,
  subscribeMetricRegistry,
  useMetricValue,
} from "@/lib/workbench/metric-registry.ts";

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

  it("订阅值变化，inactive 停订阅，恢复时立即读取最新值", () => {
    let value = 1;
    let emit: () => void = () => undefined;
    const disposeSource = vi.fn();
    const subscribe = vi.fn((listener: () => void) => {
      emit = listener;
      return disposeSource;
    });
    registerMetric({
      ...makeRegistration("live"),
      read: () => ({ kind: "instant", value }),
      subscribe,
    });
    const { result, rerender } = renderHook(
      ({ active }) => useMetricValue("live", active),
      { initialProps: { active: true } }
    );
    expect(result.current).toEqual({ kind: "instant", value: 1 });

    act(() => {
      value = 2;
      emit();
    });
    expect(result.current).toEqual({ kind: "instant", value: 2 });

    rerender({ active: false });
    expect(disposeSource).toHaveBeenCalledOnce();
    expect(result.current).toBeNull();
    value = 3;
    rerender({ active: true });
    expect(result.current).toEqual({ kind: "instant", value: 3 });
    expect(subscribe).toHaveBeenCalledTimes(2);
  });

  it("同 id registration 替换后退订旧源并读取新源", () => {
    const disposeFirst = vi.fn();
    registerMetric({
      ...makeRegistration("replace"),
      read: () => ({ kind: "instant", value: 1 }),
      subscribe: () => disposeFirst,
    });
    const { result } = renderHook(() => useMetricValue("replace", true));

    act(() => {
      registerMetric({
        ...makeRegistration("replace"),
        read: () => ({ kind: "instant", value: 2 }),
        subscribe: () => () => undefined,
      });
    });
    expect(disposeFirst).toHaveBeenCalledOnce();
    expect(result.current).toEqual({ kind: "instant", value: 2 });
  });
});
