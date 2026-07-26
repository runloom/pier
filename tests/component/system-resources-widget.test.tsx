import type { WorkbenchWidgetComponentProps } from "@plugins/api/renderer.ts";
import { act, cleanup, render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { SystemResourcesWidget } from "@/panel-kits/workbench/core-widgets/system-resources-widget.tsx";
import { usePierResourceStore } from "@/stores/pier-resource.store.ts";

const SNAPSHOT = {
  appProcesses: [
    {
      cpuPercent: 0.12,
      memoryBytes: 180 * 1024 * 1024,
      pid: 11,
      role: "main" as const,
      typeName: "Browser",
    },
    {
      cpuPercent: 0.08,
      memoryBytes: 90 * 1024 * 1024,
      pid: 12,
      role: "window" as const,
      typeName: "Tab",
    },
  ],
  meta: {
    cpuWarmingUp: false,
    platform: "darwin" as const,
    treeCapability: "full" as const,
  },
  sampledAt: Date.now(),
  sessions: [
    {
      cpuPercent: 0.9,
      hot: true,
      identity: {
        agentId: "codex" as const,
        kind: "agent" as const,
        sessionTitle: "Hot agent",
        status: "processing",
      },
      memoryBytes: 400 * 1024 * 1024,
      panelId: "panel-hot",
      processCount: 3,
      shellPid: 501,
      topProcess: {
        cpuPercent: 0.85,
        memoryBytes: 350 * 1024 * 1024,
        name: "node",
        pid: 502,
      },
      windowId: "1",
    },
  ],
  summary: {
    hostLogicalCpuCount: 10,
    hostMemoryFreeBytes: 4 * 1024 * 1024 * 1024,
    hostMemoryTotalBytes: 16 * 1024 * 1024 * 1024,
    hotCount: 1,
    pierAppCpuPercent: 0.2,
    pierAppMemoryBytes: 270 * 1024 * 1024,
    terminalCount: 1,
    totalRelatedCpuPercent: 1.1,
    totalRelatedMemoryBytes: 670 * 1024 * 1024,
    workloadCpuPercent: 0.9,
    workloadMemoryBytes: 400 * 1024 * 1024,
  },
};

const originalPierDescriptor = Object.getOwnPropertyDescriptor(window, "pier");

function renderWidget(overrides: Partial<WorkbenchWidgetComponentProps> = {}) {
  const props: WorkbenchWidgetComponentProps = {
    instanceId: "core.system-resources",
    params: {},
    refreshToken: 0,
    size: { h: 4, w: 4 },
    updateParams: vi.fn(),
    visible: false,
    ...overrides,
  };
  return render(<SystemResourcesWidget {...props} />);
}

beforeAll(async () => {
  await initI18n();
});

beforeEach(() => {
  usePierResourceStore.setState({
    cpuHistory: [
      { ts: 1, value: 0.1 },
      { ts: 2, value: 0.2 },
    ],
    error: null,
    snapshot: SNAPSHOT,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  if (originalPierDescriptor) {
    Object.defineProperty(window, "pier", originalPierDescriptor);
  } else {
    Reflect.deleteProperty(window, "pier");
  }
  vi.restoreAllMocks();
});

describe("SystemResourcesWidget", () => {
  it("renders the shared loading and error states before data is available", () => {
    usePierResourceStore.setState({
      cpuHistory: [],
      error: null,
      snapshot: null,
    });
    renderWidget();
    expect(
      document.querySelector('[data-slot="widget-skeleton"]')
    ).toBeInTheDocument();

    act(() => usePierResourceStore.setState({ error: "snapshot failed" }));
    expect(
      document.querySelector('[data-slot="widget-error"]')
    ).toBeInTheDocument();
  });

  it("renders full density KPIs and session rows without CPU trend", () => {
    renderWidget({ size: { h: 4, w: 4 } });
    expect(screen.getByTestId("pier-resources-content")).toHaveAttribute(
      "data-density",
      "full"
    );
    const kpis = screen.getByTestId("pier-resources-kpis");
    expect(kpis).toBeInTheDocument();
    expect(kpis).toHaveAttribute("data-layout", "auto-fit");
    // 列定义走 inline style，不依赖 Tailwind 任意值是否进包
    expect(kpis).toHaveStyle({
      gridTemplateColumns: expect.stringContaining(
        "auto-fit"
      ) as unknown as string,
    });
    expect(kpis.className).toContain("grid");
    expect(kpis.className).not.toContain("grid-cols-1");
    expect(
      screen.queryByTestId("pier-resources-trend")
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("pier-resources-sessions")).toBeInTheDocument();
    expect(screen.getByText("Hot agent")).toBeInTheDocument();
    // 卡面只保留会话列表，不展示 Pier 进程分项
    expect(
      screen.queryByTestId("pier-resources-process-list")
    ).not.toBeInTheDocument();
  });

  it("uses compact density for min size and hides trend/list", () => {
    renderWidget({ size: { h: 2, w: 2 } });
    expect(screen.getByTestId("pier-resources-content")).toHaveAttribute(
      "data-density",
      "compact"
    );
    const kpis = screen.getByTestId("pier-resources-kpis");
    expect(kpis).toBeInTheDocument();
    // compact 仍 2 个 KPI → auto-fit；窄卡由 CSS 自然换行，不手写 stack
    expect(kpis).toHaveAttribute("data-layout", "auto-fit");
    expect(
      screen.queryByTestId("pier-resources-trend")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("pier-resources-sessions")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("pier-resources-process-list")
    ).not.toBeInTheDocument();
  });

  it("uses medium density and shows sessions", () => {
    renderWidget({ size: { h: 3, w: 4 } });
    expect(screen.getByTestId("pier-resources-content")).toHaveAttribute(
      "data-density",
      "medium"
    );
    expect(screen.getByTestId("pier-resources-sessions")).toBeInTheDocument();
    expect(screen.getByText("Hot agent")).toBeInTheDocument();
  });

  it("treats tall narrow cards as full and fills with list content", () => {
    renderWidget({ size: { h: 5, w: 2 } });
    expect(screen.getByTestId("pier-resources-content")).toHaveAttribute(
      "data-density",
      "full"
    );
    expect(screen.getByTestId("pier-resources-sessions")).toBeInTheDocument();
    const kpis = screen.getByTestId("pier-resources-kpis");
    expect(kpis.childElementCount).toBeGreaterThanOrEqual(2);
    // 顶对齐，禁止整卡垂直居中
    expect(screen.getByTestId("pier-resources-content")).toHaveClass(
      "justify-start"
    );
  });

  it("refreshes on demand and stops polling while hidden", async () => {
    vi.useFakeTimers();
    usePierResourceStore.setState({
      cpuHistory: [],
      error: null,
      snapshot: null,
    });
    const snapshot = vi.fn().mockResolvedValue(SNAPSHOT);
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        ...window.pier,
        resources: { snapshot },
      },
    });

    const view = renderWidget({ visible: true });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId("pier-resources-content")).toBeInTheDocument();
    expect(snapshot).toHaveBeenCalledTimes(1);

    view.rerender(
      <SystemResourcesWidget
        instanceId="core.system-resources"
        params={{}}
        refreshToken={1}
        size={{ h: 4, w: 4 }}
        updateParams={vi.fn()}
        visible
      />
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(snapshot).toHaveBeenCalledTimes(2);

    view.rerender(
      <SystemResourcesWidget
        instanceId="core.system-resources"
        params={{}}
        refreshToken={1}
        size={{ h: 4, w: 4 }}
        updateParams={vi.fn()}
        visible={false}
      />
    );
    await act(async () => vi.advanceTimersByTimeAsync(4000));
    expect(snapshot).toHaveBeenCalledTimes(2);
  });

  it("polls immediately on refresh while another visible consumer owns polling", async () => {
    vi.useFakeTimers();
    usePierResourceStore.setState({
      cpuHistory: [],
      error: null,
      snapshot: null,
    });
    const snapshot = vi.fn().mockResolvedValue(SNAPSHOT);
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        ...window.pier,
        resources: { snapshot },
      },
    });

    renderWidget({ instanceId: "first", visible: true });
    const second = renderWidget({ instanceId: "second", visible: true });
    await act(async () => {
      await Promise.resolve();
    });
    expect(snapshot).toHaveBeenCalledTimes(1);

    second.rerender(
      <SystemResourcesWidget
        instanceId="second"
        params={{}}
        refreshToken={1}
        size={{ h: 4, w: 4 }}
        updateParams={vi.fn()}
        visible
      />
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(snapshot).toHaveBeenCalledTimes(2);
  });
});
