import type { MissionControlWidgetComponentProps } from "@plugins/api/renderer.ts";
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
import { SystemResourcesWidget } from "@/panel-kits/mission-control/core-widgets/system-resources-widget.tsx";
import { useSystemStatsStore } from "@/stores/system-stats.store.ts";

const SNAPSHOT = {
  appMemoryRss: 256 * 1024 * 1024,
  cpuCount: 8,
  cpuUsage: 0.25,
  loadAvg1: 1,
  loadAvg5: 0.75,
  loadAvg15: 0.5,
  memoryFree: 4 * 1024 * 1024 * 1024,
  memoryTotal: 16 * 1024 * 1024 * 1024,
  sampledAt: 1,
};

const originalPierDescriptor = Object.getOwnPropertyDescriptor(window, "pier");

function renderWidget(
  overrides: Partial<MissionControlWidgetComponentProps> = {}
) {
  const props: MissionControlWidgetComponentProps = {
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
  useSystemStatsStore.setState({
    cpuHistory: [],
    error: null,
    snapshot: null,
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
    renderWidget();
    expect(
      document.querySelector('[data-slot="widget-skeleton"]')
    ).toBeInTheDocument();

    act(() => useSystemStatsStore.setState({ error: "snapshot failed" }));
    expect(
      document.querySelector('[data-slot="widget-error"]')
    ).toBeInTheDocument();
  });

  it("renders sampled data, refreshes on demand, and stops polling while hidden", async () => {
    vi.useFakeTimers();
    const snapshot = vi.fn().mockResolvedValue(SNAPSHOT);
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        ...window.pier,
        systemStats: { snapshot },
      },
    });

    const view = renderWidget({ visible: true });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId("system-resources-grid")).toBeInTheDocument();
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
    const snapshot = vi.fn().mockResolvedValue(SNAPSHOT);
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        ...window.pier,
        systemStats: { snapshot },
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
