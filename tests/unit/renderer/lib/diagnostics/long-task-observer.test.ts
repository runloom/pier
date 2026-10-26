import { rendererHangBreadcrumbSchema } from "@shared/contracts/diagnostics/hang-breadcrumb.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetLongTaskObserverForTests,
  buildLongTaskBreadcrumbs,
  flushPendingLongTasks,
  installLongTaskObserver,
  LONG_TASK_BUFFER_MAX,
  LONG_TASK_BURST_LIMIT,
  LONG_TASK_MIN_DURATION_MS,
  type LongTaskSample,
} from "@/lib/diagnostics/long-task-observer.ts";

type ObserverCallback = (entries: readonly LongTaskSample[]) => void;

/** 可控的 PerformanceObserver 替身：测试直接喂条目，不依赖真实浏览器事件。 */
function createFakeObserverFactory() {
  const callbacks: ObserverCallback[] = [];
  const disconnect = vi.fn();
  const createObserver = vi.fn((callback: ObserverCallback) => {
    callbacks.push(callback);
    return { disconnect };
  });
  return {
    callbacks,
    createObserver,
    disconnect,
    /** 取最近安装的那一个观察者的回调。 */
    latest(): ObserverCallback {
      const callback = callbacks.at(-1);
      if (callback === undefined) {
        throw new Error("no observer installed");
      }
      return callback;
    },
  };
}

describe("buildLongTaskBreadcrumbs", () => {
  it("drops samples below the threshold and sorts by start time", () => {
    const crumbs = buildLongTaskBreadcrumbs([
      { durationMs: 900, startTime: 200 },
      { durationMs: 120, startTime: 10 },
      { durationMs: 300, startTime: 40 },
    ]);
    expect(crumbs).toHaveLength(2);
    expect(crumbs.map((crumb) => crumb.detail)).toEqual([
      "longtask 300ms start 40",
      "longtask 900ms start 200 gap 160",
    ]);
    expect(crumbs.every((crumb) => crumb.kind === "longtask")).toBe(true);
  });

  it("keeps only the newest burst and folds the rest into one suppressed count", () => {
    const samples: LongTaskSample[] = Array.from(
      { length: 10 },
      (_, index) => ({
        durationMs: 250,
        startTime: index * 1000,
      })
    );
    const crumbs = buildLongTaskBreadcrumbs(samples, { burstLimit: 3 });
    expect(crumbs).toHaveLength(3);
    expect(crumbs[0]?.detail).toBe("longtask 250ms start 7000");
    expect(crumbs[1]?.detail).toBe("longtask 250ms start 8000 gap 1000");
    // suppressed 只挂在最新一条上，聚合口径只有这一处。
    expect(crumbs[2]?.detail).toBe(
      "longtask 250ms start 9000 gap 1000 suppressed 7"
    );
  });

  it("respects the threshold override", () => {
    const samples: LongTaskSample[] = [{ durationMs: 250, startTime: 0 }];
    expect(buildLongTaskBreadcrumbs(samples, { minDurationMs: 500 })).toEqual(
      []
    );
    expect(
      buildLongTaskBreadcrumbs(samples, { minDurationMs: 200 })
    ).toHaveLength(1);
    expect(LONG_TASK_MIN_DURATION_MS).toBe(200);
  });

  it("merges caller-side drops into the suppressed count", () => {
    const samples: LongTaskSample[] = [{ durationMs: 400, startTime: 0 }];
    const crumbs = buildLongTaskBreadcrumbs(samples, { suppressedCount: 12 });
    expect(crumbs[0]?.detail).toBe("longtask 400ms start 0 suppressed 12");
  });

  it("returns nothing for empty or non-finite input", () => {
    expect(buildLongTaskBreadcrumbs([])).toEqual([]);
    expect(
      buildLongTaskBreadcrumbs([
        { durationMs: Number.NaN, startTime: 0 },
        { durationMs: 400, startTime: Number.POSITIVE_INFINITY },
      ])
    ).toEqual([]);
  });

  it("emits contract-valid crumbs even when the detail is long", () => {
    const samples: LongTaskSample[] = Array.from(
      { length: 500 },
      (_, index) => ({
        durationMs: 250,
        startTime: index * 1000,
      })
    );
    const crumbs = buildLongTaskBreadcrumbs(samples);
    expect(crumbs).toHaveLength(LONG_TASK_BURST_LIMIT);
    for (const crumb of crumbs) {
      expect(rendererHangBreadcrumbSchema.safeParse(crumb).success).toBe(true);
    }
  });
});

describe("installLongTaskObserver", () => {
  const noteBatch = vi.fn();

  /** 所有发射过的 detail，按发射顺序摊平。 */
  function details(): string[] {
    return noteBatch.mock.calls.flatMap((call) =>
      (call[0] as { detail?: string }[]).map((crumb) => crumb.detail ?? "")
    );
  }

  beforeEach(() => {
    noteBatch.mockReset();
    __resetLongTaskObserverForTests();
  });

  afterEach(() => {
    __resetLongTaskObserverForTests();
    vi.useRealTimers();
  });

  it("notes the first long task immediately", () => {
    const fake = createFakeObserverFactory();
    installLongTaskObserver({
      createObserver: fake.createObserver,
      noteBatch,
    });

    fake.latest()([{ durationMs: 450, startTime: 12 }]);

    expect(noteBatch).toHaveBeenCalledTimes(1);
    expect(noteBatch.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({
        detail: "longtask 450ms start 12",
        kind: "longtask",
      }),
    ]);
  });

  it("emits a throttled burst as one batch, not one IPC per crumb", () => {
    vi.useFakeTimers();
    const fake = createFakeObserverFactory();
    installLongTaskObserver({
      createObserver: fake.createObserver,
      minGapMs: 1000,
      noteBatch,
    });

    fake.latest()([{ durationMs: 300, startTime: 0 }]);
    expect(noteBatch).toHaveBeenCalledTimes(1);

    fake.latest()([{ durationMs: 300, startTime: 400 }]);
    fake.latest()([{ durationMs: 300, startTime: 800 }]);
    // 节流窗口内只缓冲，不发射。
    expect(noteBatch).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1000);
    expect(noteBatch).toHaveBeenCalledTimes(2);
    expect(noteBatch.mock.calls[1]?.[0]).toHaveLength(2);
    expect(details()).toEqual([
      "longtask 300ms start 0",
      "longtask 300ms start 400",
      "longtask 300ms start 800 gap 400",
    ]);
  });

  it("does not burn the throttle window on samples that never qualify", () => {
    vi.useFakeTimers();
    const fake = createFakeObserverFactory();
    installLongTaskObserver({
      createObserver: fake.createObserver,
      minGapMs: 1000,
      noteBatch,
    });

    // t=0：首条立即发射，节流窗口从此刻开始。
    fake.latest()([{ durationMs: 300, startTime: 0 }]);
    noteBatch.mockClear();

    // t=500：Chromium 从 50ms 起就报 longtask，这条不够长，不该推进窗口。
    vi.advanceTimersByTime(500);
    fake.latest()([{ durationMs: 150, startTime: 400 }]);
    expect(noteBatch).not.toHaveBeenCalled();

    // t=900：真正阻塞的任务仍在首个发射后的 1s 窗口内，补发即可。
    vi.advanceTimersByTime(400);
    fake.latest()([{ durationMs: 900, startTime: 600 }]);

    // 若上面的短任务错误地推进了窗口，这里要等到 t=1500 才会发射。
    vi.advanceTimersByTime(100);
    expect(details()).toEqual(["longtask 900ms start 600"]);
  });

  it("filters below-threshold entries before the buffer cap can evict a real block", () => {
    vi.useFakeTimers();
    const fake = createFakeObserverFactory();
    installLongTaskObserver({
      createObserver: fake.createObserver,
      minGapMs: 60_000,
      noteBatch,
    });

    // t=0 首条立即发射，开一个很长的节流窗口。
    fake.latest()([{ durationMs: 300, startTime: 0 }]);
    noteBatch.mockClear();

    // 窗口内先落一条真正阻塞的任务，再用大量短抖动灌满缓冲。
    vi.advanceTimersByTime(100);
    fake.latest()([{ durationMs: 900, startTime: 100 }]);
    const storm = Array.from({ length: LONG_TASK_BUFFER_MAX + 40 }, (_, i) => ({
      durationMs: 80,
      startTime: 200 + i,
    }));
    fake.latest()(storm);

    flushPendingLongTasks();

    // 短任务在入队前就被阈值滤掉，挤不掉那条 900ms 的阻塞。
    expect(details()).toEqual(["longtask 900ms start 100"]);
  });

  it("counts buffer overflow into the suppressed total", () => {
    vi.useFakeTimers();
    const fake = createFakeObserverFactory();
    installLongTaskObserver({
      createObserver: fake.createObserver,
      minGapMs: 60_000,
      noteBatch,
    });

    fake.latest()([{ durationMs: 300, startTime: 0 }]);
    noteBatch.mockClear();

    const total = LONG_TASK_BUFFER_MAX + 20;
    for (let index = 1; index <= total; index += 1) {
      fake.latest()([{ durationMs: 300, startTime: index * 10 }]);
    }
    vi.advanceTimersByTime(60_000);

    // 一批最多 6 条，其余全部合进 suppressed。
    expect(details()).toHaveLength(LONG_TASK_BURST_LIMIT);
    const last = details().at(-1) ?? "";
    expect(last).toContain(`start ${total * 10}`);
    // 溢出 20 条 + burst 截断 (64 - 6) 条 = 78。
    expect(last).toContain(
      `suppressed ${20 + (LONG_TASK_BUFFER_MAX - LONG_TASK_BURST_LIMIT)}`
    );
  });

  it("flushes buffered samples on demand", () => {
    vi.useFakeTimers();
    const fake = createFakeObserverFactory();
    installLongTaskObserver({
      createObserver: fake.createObserver,
      minGapMs: 60_000,
      noteBatch,
    });

    fake.latest()([{ durationMs: 300, startTime: 0 }]);
    fake.latest()([{ durationMs: 700, startTime: 500 }]);
    noteBatch.mockClear();

    flushPendingLongTasks();

    expect(details()).toEqual(["longtask 700ms start 500"]);
  });

  it("flushes before disposing so measured blocks are not lost", () => {
    vi.useFakeTimers();
    const fake = createFakeObserverFactory();
    const dispose = installLongTaskObserver({
      createObserver: fake.createObserver,
      minGapMs: 60_000,
      noteBatch,
    });

    fake.latest()([{ durationMs: 300, startTime: 0 }]);
    fake.latest()([{ durationMs: 4000, startTime: 500 }]);
    noteBatch.mockClear();

    dispose();
    vi.advanceTimersByTime(120_000);

    expect(details()).toEqual(["longtask 4000ms start 500"]);
    expect(fake.disconnect).toHaveBeenCalled();
  });

  it("flushes the previous observer's buffer when installed twice", () => {
    vi.useFakeTimers();
    const first = createFakeObserverFactory();
    const second = createFakeObserverFactory();
    installLongTaskObserver({
      createObserver: first.createObserver,
      noteBatch,
    });
    first.latest()([{ durationMs: 300, startTime: 0 }]);
    first.latest()([{ durationMs: 4000, startTime: 500 }]);
    noteBatch.mockClear();

    installLongTaskObserver({
      createObserver: second.createObserver,
      noteBatch,
    });

    expect(details()).toEqual(["longtask 4000ms start 500"]);
    expect(first.disconnect).toHaveBeenCalledOnce();
  });

  it("disposes the previous observer when the new environment cannot observe", () => {
    const first = createFakeObserverFactory();
    installLongTaskObserver({
      createObserver: first.createObserver,
      noteBatch,
    });
    first.latest()([{ durationMs: 300, startTime: 0 }]);
    noteBatch.mockClear();

    const dispose = installLongTaskObserver({
      createObserver: () => null,
      noteBatch,
    });

    expect(first.disconnect).toHaveBeenCalledOnce();
    // 旧观察者已经摘掉，没有残留的主人继续写日志。
    flushPendingLongTasks();
    expect(noteBatch).not.toHaveBeenCalled();
    expect(() => dispose()).not.toThrow();
  });

  it("ignores empty entry batches", () => {
    const fake = createFakeObserverFactory();
    installLongTaskObserver({ createObserver: fake.createObserver, noteBatch });
    fake.latest()([]);
    expect(noteBatch).not.toHaveBeenCalled();
  });
});
