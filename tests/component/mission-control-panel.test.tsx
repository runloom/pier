import type {
  MissionControlWidgetComponentProps,
  RendererMissionControlWidgetRegistration,
} from "@plugins/api/renderer.ts";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { IDockviewPanelProps } from "dockview-react";
import { AlertTriangle } from "lucide-react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import {
  clearPluginMissionControlWidgetsForTests,
  registerPluginMissionControlWidget,
} from "@/lib/plugins/plugin-mission-control-widget-registry.ts";
import { MissionControlPanel } from "@/panel-kits/mission-control/mission-control-panel.tsx";
import { usePluginRegistryStore } from "@/stores/plugin-registry.store.ts";

const REMOVE_LABEL_RE = /remove/i;

beforeAll(async () => {
  await initI18n();
});

function makeProps(
  params: Record<string, unknown>,
  updateParameters?: ReturnType<typeof vi.fn>
): IDockviewPanelProps<Record<string, unknown>> {
  return {
    api: {
      id: "mission-control-test",
      setTitle: vi.fn(),
      updateParameters: updateParameters ?? vi.fn(),
    },
    containerApi: {},
    params,
  } as unknown as IDockviewPanelProps<Record<string, unknown>>;
}

afterEach(() => {
  clearPluginMissionControlWidgetsForTests();
  usePluginRegistryStore.setState({
    diagnostics: [],
    error: null,
    initialized: false,
    plugins: [],
  });
});

describe("MissionControlPanel", () => {
  it("renders empty state and add-widget card when no widgets", () => {
    const props = makeProps({ widgets: [] });
    render(<MissionControlPanel {...props} />);
    expect(screen.getByTestId("mission-control-empty")).toBeInTheDocument();
    expect(
      screen.getByTestId("mission-control-add-widget")
    ).toBeInTheDocument();
  });

  it("renders core activity-overview widget with testid", () => {
    const props = makeProps({
      widgets: [{ h: 3, id: "core.activity-overview", w: 4, x: 0, y: 0 }],
    });
    render(<MissionControlPanel {...props} />);
    expect(
      screen.getByTestId("mission-control-widget-core.activity-overview")
    ).toBeInTheDocument();
  });

  it("renders plugin-disabled placeholder when plugin is disabled", () => {
    usePluginRegistryStore.setState({
      diagnostics: [],
      error: null,
      initialized: true,
      plugins: [
        {
          effectivePermissions: [],
          enabled: false,
          manifest: {
            apiVersion: 1,
            commands: [],
            missionControlWidgets: [
              { id: "pier.test.widget", permissions: [], title: "Test" },
            ],
            engines: { pier: ">=0.1.0" },
            id: "pier.test",
            name: "Test",
            panels: [],
            permissions: [],
            source: { kind: "builtin" },
            terminalStatusItems: [],
            version: "1.0.0",
          },
          runtime: { canToggle: true, enabled: false, kind: "builtin" },
        },
      ],
    });

    const props = makeProps({
      widgets: [{ h: 3, id: "pier.test.widget", w: 4, x: 0, y: 0 }],
    });
    render(<MissionControlPanel {...props} />);
    expect(
      screen.getByTestId("mission-control-widget-pier.test.widget")
    ).toBeInTheDocument();
  });

  it("removes a widget when remove button is clicked", () => {
    const updateParameters = vi.fn();
    const props = makeProps(
      {
        widgets: [{ h: 3, id: "core.activity-overview", w: 4, x: 0, y: 0 }],
      },
      updateParameters
    );

    render(<MissionControlPanel {...props} />);

    const removeButton = screen.getByLabelText(REMOVE_LABEL_RE);
    fireEvent.click(removeButton);

    expect(updateParameters).toHaveBeenCalledWith({ widgets: [] });
  });

  it("hover controls visible on group-hover (focus:opacity-100 assertion)", () => {
    const props = makeProps({
      widgets: [{ h: 3, id: "core.activity-overview", w: 4, x: 0, y: 0 }],
    });
    render(<MissionControlPanel {...props} />);

    const removeButton = screen.getByLabelText(REMOVE_LABEL_RE);
    expect(removeButton.className).toContain("opacity-0");
    expect(removeButton.className).toContain("group-hover:opacity-100");
    expect(removeButton.className).toContain("focus:opacity-100");
  });

  it("catches widget error via ErrorBoundary without crashing panel", () => {
    function CrashingWidget(_props: MissionControlWidgetComponentProps): never {
      throw new Error("widget boom");
    }

    const crashReg: RendererMissionControlWidgetRegistration = {
      component: CrashingWidget,
      icon: AlertTriangle,
      id: "pier.crash.widget",
    };

    registerPluginMissionControlWidget(crashReg);

    usePluginRegistryStore.setState({
      diagnostics: [],
      error: null,
      initialized: true,
      plugins: [
        {
          effectivePermissions: [],
          enabled: true,
          manifest: {
            apiVersion: 1,
            commands: [],
            missionControlWidgets: [
              {
                id: "pier.crash.widget",
                permissions: [],
                title: "Crash",
              },
            ],
            engines: { pier: ">=0.1.0" },
            id: "pier.crash",
            name: "Crash",
            panels: [],
            permissions: [],
            source: { kind: "builtin" },
            terminalStatusItems: [],
            version: "1.0.0",
          },
          runtime: { canToggle: true, enabled: true, kind: "builtin" },
        },
      ],
    });

    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const props = makeProps({
      widgets: [{ h: 3, id: "pier.crash.widget", w: 4, x: 0, y: 0 }],
    });
    render(<MissionControlPanel {...props} />);

    expect(screen.getByText("widget boom")).toBeInTheDocument();

    spy.mockRestore();
  });
  it("首渲后注册的插件 widget 从加载占位切换为真实组件", () => {
    usePluginRegistryStore.setState({
      diagnostics: [],
      error: null,
      initialized: true,
      plugins: [
        {
          effectivePermissions: [],
          enabled: true,
          manifest: {
            apiVersion: 1,
            commands: [],
            missionControlWidgets: [
              { id: "pier.late.widget", permissions: [], title: "Late" },
            ],
            engines: { pier: ">=0.1.0" },
            id: "pier.late",
            name: "Late",
            panels: [],
            permissions: [],
            source: { kind: "builtin" },
            terminalStatusItems: [],
            version: "1.0.0",
          },
          runtime: { canToggle: true, enabled: true, kind: "builtin" },
        },
      ],
    });

    const props = makeProps({
      widgets: [{ h: 3, id: "pier.late.widget", w: 4, x: 0, y: 0 }],
    });
    render(<MissionControlPanel {...props} />);

    // 插件已启用但组件未注册 → 加载占位，真实组件不在场
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByTestId("late-widget-body")).not.toBeInTheDocument();

    function LateWidget(_props: MissionControlWidgetComponentProps) {
      return <div data-testid="late-widget-body">late widget ready</div>;
    }

    act(() => {
      registerPluginMissionControlWidget({
        component: LateWidget,
        icon: AlertTriangle,
        id: "pier.late.widget",
      });
    });

    // 锁新行为：注册触发 revision 变化 → registrations Map 换新引用 →
    // resolved 重算 → 占位切换为真实组件
    expect(screen.getByTestId("late-widget-body")).toBeInTheDocument();
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  });

  it("自定义 resize 手柄存在（class react-resizable-handle-se）", () => {
    const props = makeProps({
      widgets: [{ h: 3, id: "core.activity-overview", w: 4, x: 0, y: 0 }],
    });
    const { container } = render(<MissionControlPanel {...props} />);
    const handle = container.querySelector(".react-resizable-handle-se");
    expect(handle).toBeInTheDocument();
  });
});

describe("固定格宽与派生模式", () => {
  it("窄容器（jsdom 回退 800px → k=8）：网格容器宽 788px 且左对齐（无居中类）", () => {
    const props = makeProps({
      widgets: [{ h: 3, id: "core.activity-overview", w: 4, x: 0, y: 0 }],
    });
    const { container } = render(<MissionControlPanel {...props} />);
    const wrapper = container.querySelector(
      "[data-testid='mission-control-grid-wrapper']"
    );
    expect(wrapper).toBeInTheDocument();
    expect((wrapper as HTMLElement).style.width).toBe("788px");
    // 左对齐（用户定）：边距恒等于卡间距，不做居中留白
    expect((wrapper as HTMLElement).className).not.toContain("mx-auto");
  });

  it("派生模式守卫：挂载与渲染不把派生坐标写回 params", () => {
    const updateParameters = vi.fn();
    // w=12 的卡片在 k=8 下会被派生 clamp 到 8——若守卫失效，
    // RGL 挂载触发的 onLayoutChange 会把 w=8 写回 params
    const props = makeProps(
      { widgets: [{ h: 3, id: "core.activity-overview", w: 12, x: 0, y: 0 }] },
      updateParameters
    );
    render(<MissionControlPanel {...props} />);
    expect(updateParameters).not.toHaveBeenCalled();
  });

  it("params 含非法条目时抢救渲染合法条目，且不主动回写", () => {
    const updateParameters = vi.fn();
    const props = makeProps(
      {
        widgets: [
          { h: 3, id: "core.activity-overview", w: 4, x: 0, y: 0 },
          { h: 3, id: "broken", w: 4, x: 99, y: 0 },
        ],
      },
      updateParameters
    );
    render(<MissionControlPanel {...props} />);
    expect(
      screen.getByTestId("mission-control-widget-core.activity-overview")
    ).toBeInTheDocument();
    expect(updateParameters).not.toHaveBeenCalled();
  });

  it("CardContent 声明 @container，为 widget 内容提供容器查询上下文", () => {
    const props = makeProps({
      widgets: [{ h: 3, id: "core.activity-overview", w: 4, x: 0, y: 0 }],
    });
    const { container } = render(<MissionControlPanel {...props} />);
    const content = container.querySelector("[data-slot='card-content']");
    expect(content?.className).toContain("@container");
  });

  it("ActivityWidget 统计块带容器查询变体（窄卡纵排、宽卡三列）", () => {
    const props = makeProps({
      widgets: [{ h: 3, id: "core.activity-overview", w: 4, x: 0, y: 0 }],
    });
    const { container } = render(<MissionControlPanel {...props} />);
    const statGrid = container.querySelector(
      "[data-testid='activity-stat-grid']"
    );
    expect(statGrid?.className).toContain("grid-cols-1");
    expect(statGrid?.className).toContain("@[14rem]:grid-cols-3");
  });
});
