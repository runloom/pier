// @vitest-environment node
import {
  __resetHangBreadcrumbsForTests,
  clearHangBreadcrumbsForWindow,
  getHangBreadcrumbsForDiagnostics,
  getHangBreadcrumbsForWindow,
  normalizeHangBreadcrumbBatch,
  readRendererMetricForSender,
  registerRendererHangBreadcrumbIpc,
  rememberHangBreadcrumb,
} from "@main/ipc/renderer-hang-breadcrumb.ts";
import {
  clampHangBreadcrumbPath,
  HANG_BREADCRUMB_DIAGNOSTICS_MAX,
  HANG_BREADCRUMB_PATH_MAX,
  rendererHangBreadcrumbSchema,
} from "@shared/contracts/diagnostics/hang-breadcrumb.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

const WINDOW_ID = 7;
const findAppWindowByWebContents = vi.fn();

vi.mock("@main/windows/identity.ts", () => ({
  findAppWindowByWebContents: (sender: unknown) =>
    findAppWindowByWebContents(sender),
}));

afterEach(() => {
  __resetHangBreadcrumbsForTests();
  findAppWindowByWebContents.mockReset();
});

describe("readRendererMetricForSender", () => {
  const metrics = [
    { pid: 1, type: "Browser" },
    {
      cpu: { percentCPUUsage: 76.42 },
      memory: { workingSetSize: 1_479_680 },
      pid: 4242,
      type: "Tab",
    },
  ];

  it("reads the sender renderer's CPU and working set", () => {
    expect(
      readRendererMetricForSender({ getOSProcessId: () => 4242 }, metrics)
    ).toEqual({ cpuPercent: 76.4, workingSetMb: 1445 });
  });

  it("returns null when the sender has no metric row or is gone", () => {
    expect(
      readRendererMetricForSender({ getOSProcessId: () => 9999 }, metrics)
    ).toBe(null);
    expect(
      readRendererMetricForSender({ getOSProcessId: () => 0 }, metrics)
    ).toBe(null);
    expect(
      readRendererMetricForSender(
        {
          getOSProcessId: () => {
            throw new Error("gone");
          },
        },
        metrics
      )
    ).toBe(null);
  });
});

describe("registerRendererHangBreadcrumbIpc", () => {
  type Handler = (event: unknown, raw: unknown) => void;

  /** 注册一次 IPC，返回可直接调用的 handler 与最后一次落盘的记录。 */
  function install(
    readMetric?: () => {
      cpuPercent: number | null;
      workingSetMb: number | null;
    } | null
  ): (raw: unknown) => void {
    let handler: Handler | null = null;
    registerRendererHangBreadcrumbIpc(
      {
        on: (_channel: string, listener: Handler) => {
          handler = listener;
        },
      } as never,
      readMetric === undefined ? {} : { readMetric: () => readMetric() }
    );
    if (handler === null) {
      throw new Error("handler not registered");
    }
    const registered = handler as Handler;
    return (raw: unknown) =>
      registered({ sender: { id: 1, getOSProcessId: () => 4242 } }, raw);
  }

  it("stamps main-side renderer metrics onto every crumb", () => {
    findAppWindowByWebContents.mockReturnValue({ id: WINDOW_ID } as never);
    const send = install(() => ({ cpuPercent: 76.4, workingSetMb: 1445 }));

    send([
      { kind: "heartbeat", phase: "tick", detail: "alive-3" },
      { kind: "longtask", phase: "state", detail: "longtask 900ms start 10" },
    ]);

    const stored = getHangBreadcrumbsForWindow(WINDOW_ID);
    expect(stored).toHaveLength(2);
    expect(stored[0]).toMatchObject({
      detail: "alive-3",
      rendererCpuPercent: 76.4,
      rendererWorkingSetMb: 1445,
    });
    expect(stored[1]).toMatchObject({
      kind: "longtask",
      rendererWorkingSetMb: 1445,
    });
  });

  it("still records the trail when metrics are unavailable", () => {
    findAppWindowByWebContents.mockReturnValue({ id: WINDOW_ID } as never);
    const send = install(() => {
      throw new Error("metrics exploded");
    });

    send({ kind: "mark", phase: "state", detail: "trail-installed" });

    const stored = getHangBreadcrumbsForWindow(WINDOW_ID);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.rendererCpuPercent).toBeUndefined();
    expect(stored[0]?.rendererWorkingSetMb).toBeUndefined();
  });
});

describe("renderer hang breadcrumbs", () => {
  it("accepts panel-close, panel-activate, command, and files-conflict", () => {
    expect(
      rendererHangBreadcrumbSchema.safeParse({
        kind: "panel-close",
        phase: "start",
        commandId: "pier.panel.closeActive",
        activePanelComponent: "pier.files.filePanel",
        panelId: "pier.files.filePanel:disk:x",
        detail: "closeActive",
      }).success
    ).toBe(true);
  });

  it("accepts longtask crumbs so a blocking task survives into diagnostics", () => {
    // 长任务只在阻塞结束后才写；它必须能通过契约，否则「谁占住了主线程」
    // 这条唯一可用的证据会在 main 侧被静默丢弃。
    const parsed = rendererHangBreadcrumbSchema.safeParse({
      kind: "longtask",
      phase: "state",
      detail: "longtask 4120ms start 88231 gap 1000 suppressed 3",
    });
    expect(parsed.success).toBe(true);
    expect(
      normalizeHangBreadcrumbBatch([
        { kind: "longtask", phase: "state", detail: "longtask 900ms start 10" },
        { kind: "longtask", phase: "state", detail: "longtask 120ms start 20" },
      ])
    ).toHaveLength(2);
  });

  it("accepts main-side renderer metrics on any crumb", () => {
    // renderer 自己的 performance.memory 不可信，CPU / 工作集由 main 补。
    const parsed = rendererHangBreadcrumbSchema.safeParse({
      kind: "heartbeat",
      phase: "tick",
      detail: "alive-7",
      rendererCpuPercent: 76.4,
      rendererWorkingSetMb: 1445,
    });
    expect(parsed.success).toBe(true);
    expect(
      rendererHangBreadcrumbSchema.safeParse({
        kind: "heartbeat",
        phase: "tick",
        rendererCpuPercent: -1,
      }).success
    ).toBe(false);
  });

  it("clamps long paths so deep monorepo crumbs still parse", () => {
    const deep = `src/${"very/".repeat(80)}file.ts`;
    expect(deep.length).toBeGreaterThan(HANG_BREADCRUMB_PATH_MAX);
    const clamped = clampHangBreadcrumbPath(deep);
    expect(clamped?.length).toBe(HANG_BREADCRUMB_PATH_MAX);
    const crumbs = normalizeHangBreadcrumbBatch([
      {
        kind: "files-conflict",
        phase: "state",
        path: deep,
        detail: "empty-state",
      },
    ]);
    expect(crumbs).toHaveLength(1);
    expect(crumbs[0]?.path?.length).toBe(HANG_BREADCRUMB_PATH_MAX);
  });

  it("keeps valid crumbs when a batch item is invalid", () => {
    const crumbs = normalizeHangBreadcrumbBatch([
      { kind: "mark", detail: "ok-1" },
      { kind: "not-a-kind", detail: "bad" },
      { kind: "heartbeat", phase: "tick", detail: "alive-2" },
    ]);
    expect(crumbs).toHaveLength(2);
    expect(crumbs.map((c) => c.detail)).toEqual(["ok-1", "alive-2"]);
  });

  it("dumps newest diagnostics crumbs when ring is full", () => {
    for (let i = 0; i < HANG_BREADCRUMB_DIAGNOSTICS_MAX + 20; i++) {
      rememberHangBreadcrumb(7, {
        kind: "mark",
        detail: `n-${i}`,
        receivedAt: 1000 + i,
      });
    }
    const all = getHangBreadcrumbsForWindow(7);
    expect(all).toHaveLength(HANG_BREADCRUMB_DIAGNOSTICS_MAX);
    expect(all[0]?.detail).toBe("n-20");
    expect(all.at(-1)?.detail).toBe(
      `n-${HANG_BREADCRUMB_DIAGNOSTICS_MAX + 19}`
    );

    const forDiag = getHangBreadcrumbsForDiagnostics(7);
    expect(forDiag).toHaveLength(HANG_BREADCRUMB_DIAGNOSTICS_MAX);
    expect(forDiag[0]?.detail).toBe(all[0]?.detail);
    expect(forDiag.at(-1)?.detail).toBe(all.at(-1)?.detail);

    clearHangBreadcrumbsForWindow(7);
    expect(getHangBreadcrumbsForWindow(7)).toEqual([]);
  });
});
