import type {
  MissionControlWidgetComponentProps,
  MissionControlWidgetSettingsProps,
  RendererMissionControlWidgetRegistration,
} from "@plugins/api/renderer.ts";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { IDockviewPanelProps } from "dockview-react";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
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
import {
  clearPluginMissionControlWidgetsForTests,
  registerPluginMissionControlWidget,
} from "@/lib/plugins/plugin-mission-control-widget-registry.ts";
import { MissionControlPanel } from "@/panel-kits/mission-control/mission-control-panel.tsx";
import {
  resetAppDialogForTests,
  useAppDialogStore,
} from "@/stores/app-dialog.store.ts";
import { usePluginRegistryStore } from "@/stores/plugin-registry.store.ts";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const MENU_LABEL_RE = /widget menu/i;
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

function setPluginRegistry(
  plugins: Parameters<typeof usePluginRegistryStore.setState>[0] extends {
    plugins?: infer P;
  }
    ? P
    : never
): void {
  usePluginRegistryStore.setState({
    diagnostics: [],
    error: null,
    initialized: true,
    plugins,
  });
}

/** Radix DropdownMenu 触发器要 pointerdown（与 workspace-header-actions 同法）。 */
function openWidgetMenu(): void {
  const trigger = screen.getByLabelText(MENU_LABEL_RE);
  fireEvent.pointerDown(trigger, {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
}

function openPanelContextMenu(): void {
  fireEvent.contextMenu(screen.getByTestId("mission-control-grid-wrapper"), {
    button: 2,
    ctrlKey: false,
  });
}

beforeEach(() => {
  Object.defineProperties(HTMLElement.prototype, {
    hasPointerCapture: { configurable: true, value: vi.fn(() => false) },
    releasePointerCapture: { configurable: true, value: vi.fn() },
    scrollIntoView: { configurable: true, value: vi.fn() },
    setPointerCapture: { configurable: true, value: vi.fn() },
  });
  // 物料库对话框的 SidebarProvider (useIsMobile) 依赖 matchMedia — jsdom 默认不实现。
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn((query: string) => ({
      addEventListener: vi.fn(),
      addListener: vi.fn(),
      dispatchEvent: vi.fn(),
      matches: false,
      media: query,
      onchange: null,
      removeEventListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  });
});

afterEach(() => {
  resetAppDialogForTests();
  clearPluginMissionControlWidgetsForTests();
  usePluginRegistryStore.setState({
    diagnostics: [],
    error: null,
    initialized: false,
    plugins: [],
  });
});

describe("MissionControlPanel", () => {
  it("renders empty state and add-widget entry when no widgets", () => {
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
    setPluginRegistry([
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
    ] as never);

    const props = makeProps({
      widgets: [{ h: 3, id: "pier.test.widget", w: 4, x: 0, y: 0 }],
    });
    render(<MissionControlPanel {...props} />);
    expect(
      screen.getByTestId("mission-control-widget-pier.test.widget")
    ).toBeInTheDocument();
  });

  it("asks for confirmation before removing a widget", async () => {
    const updateParameters = vi.fn();
    const props = makeProps(
      { widgets: [{ h: 3, id: "core.activity-overview", w: 4, x: 0, y: 0 }] },
      updateParameters
    );
    render(<MissionControlPanel {...props} />);
    openWidgetMenu();
    fireEvent.click(
      await screen.findByTestId("mission-control-widget-menu-remove")
    );

    const dialog = useAppDialogStore.getState().current;
    expect(dialog?.kind).toBe("confirm");
    expect(updateParameters).not.toHaveBeenCalled();

    if (dialog?.kind === "confirm" || dialog?.kind === "alert") {
      await act(async () => {
        dialog.resolve(false);
      });
    }
    expect(updateParameters).not.toHaveBeenCalled();

    fireEvent.click(
      await screen.findByTestId("mission-control-widget-menu-remove")
    );
    const dialog2 = useAppDialogStore.getState().current;
    if (dialog2?.kind === "confirm" || dialog2?.kind === "alert") {
      await act(async () => {
        dialog2.resolve(true);
      });
    }

    await vi.waitFor(() => {
      expect(updateParameters).toHaveBeenCalledWith({ widgets: [] });
    });
  });

  it("edit affordances stay faintly visible without hover", () => {
    const props = makeProps({
      widgets: [{ h: 3, id: "core.activity-overview", w: 4, x: 0, y: 0 }],
    });
    const { container } = render(<MissionControlPanel {...props} />);

    const handle = container.querySelector(
      ".mission-control-widget-drag-handle"
    );
    expect(handle).toBeTruthy();
    expect(handle?.className).not.toContain("opacity-0");
    expect(handle?.className).toMatch(/opacity-40|opacity-50|opacity-60/);

    const trigger = screen.getByLabelText(MENU_LABEL_RE);
    expect(trigger.className).not.toContain("opacity-0");
    expect(trigger.className).toContain("focus-visible:opacity-100");

    const gridRoot = container.firstElementChild;
    expect(gridRoot?.className).not.toContain(
      "[&_.react-resizable-handle]:opacity-0"
    );
    expect(gridRoot?.className).toMatch(
      /\[&_\.react-resizable-handle\]:opacity-40|\[&_\.react-resizable-handle\]:opacity-50|\[&_\.react-resizable-handle\]:opacity-60/
    );
  });

  it("card menu does not expose manual resize presets", async () => {
    const props = makeProps({
      widgets: [{ h: 3, id: "core.activity-overview", w: 4, x: 0, y: 0 }],
    });

    render(<MissionControlPanel {...props} />);
    openWidgetMenu();

    expect(
      await screen.findByTestId("mission-control-widget-menu-remove")
    ).toBeInTheDocument();
    expect(screen.queryByText(/^resize$/i)).not.toBeInTheDocument();
  });

  it("未锁定布局显示拖拽提示和调整尺寸手柄", () => {
    const props = makeProps({
      widgets: [{ h: 3, id: "core.activity-overview", w: 4, x: 0, y: 0 }],
    });
    const { container } = render(<MissionControlPanel {...props} />);

    expect(
      container.querySelector(".mission-control-widget-drag-handle")
    ).toBeInTheDocument();
    expect(
      container.querySelector(".lucide-grip-vertical")
    ).toBeInTheDocument();
    expect(
      container.querySelector(".react-resizable-handle-se")
    ).toBeInTheDocument();
  });

  it("catches widget error via ErrorBoundary and offers retry", () => {
    function CrashingWidget(_props: MissionControlWidgetComponentProps): never {
      throw new Error("widget boom");
    }

    const crashReg: RendererMissionControlWidgetRegistration = {
      component: CrashingWidget,
      icon: AlertTriangle,
      id: "pier.crash.widget",
    };

    registerPluginMissionControlWidget(crashReg);

    setPluginRegistry([
      {
        effectivePermissions: [],
        enabled: true,
        manifest: {
          apiVersion: 1,
          commands: [],
          missionControlWidgets: [
            { id: "pier.crash.widget", permissions: [], title: "Crash" },
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
    ] as never);

    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const props = makeProps({
      widgets: [{ h: 3, id: "pier.crash.widget", w: 4, x: 0, y: 0 }],
    });
    render(<MissionControlPanel {...props} />);

    expect(screen.getByText("widget boom")).toBeInTheDocument();
    expect(document.querySelector('[data-slot="widget-error"]')).toBeTruthy();
    expect(screen.getByText(/retry/i)).toBeInTheDocument();

    spy.mockRestore();
  });

  it("首渲后注册的插件 widget 从骨架屏占位切换为真实组件", () => {
    setPluginRegistry([
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
    ] as never);

    const props = makeProps({
      widgets: [{ h: 3, id: "pier.late.widget", w: 4, x: 0, y: 0 }],
    });
    render(<MissionControlPanel {...props} />);

    // 插件已启用但组件未注册 → 骨架屏占位，真实组件不在场
    expect(
      screen.getByTestId("mission-control-widget-loading")
    ).toBeInTheDocument();
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

    expect(screen.getByTestId("late-widget-body")).toBeInTheDocument();
    expect(
      screen.queryByTestId("mission-control-widget-loading")
    ).not.toBeInTheDocument();
  });

  it("锁定布局隐藏拖拽提示和调整尺寸手柄", () => {
    const props = makeProps({
      locked: true,
      widgets: [{ h: 3, id: "core.activity-overview", w: 4, x: 0, y: 0 }],
    });
    const { container } = render(<MissionControlPanel {...props} />);
    expect(
      container.querySelector(".mission-control-widget-drag-handle")
    ).not.toBeInTheDocument();
    expect(
      container.querySelector(".lucide-grip-vertical")
    ).not.toBeInTheDocument();
    expect(
      container.querySelector(".react-resizable-handle-se")
    ).not.toBeInTheDocument();
  });
});

describe("物料库对话框", () => {
  it("点击添加入口打开物料库，选择物料后写入 v2 条目并关闭", async () => {
    const updateParameters = vi.fn();
    const props = makeProps({ widgets: [] }, updateParameters);
    render(<MissionControlPanel {...props} />);

    fireEvent.click(screen.getByTestId("mission-control-add-widget"));
    expect(
      await screen.findByTestId("mission-control-library")
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByTestId(
        "mission-control-widget-picker-item-core.activity-overview"
      )
    );

    expect(updateParameters).toHaveBeenCalledWith({
      widgets: [
        {
          h: 3,
          id: "core.activity-overview",
          w: 4,
          widgetId: "core.activity-overview",
          x: 0,
          y: 0,
        },
      ],
    });
    expect(
      screen.queryByTestId("mission-control-library")
    ).not.toBeInTheDocument();
  });

  it("物料库支持搜索过滤", async () => {
    const props = makeProps({ widgets: [] });
    render(<MissionControlPanel {...props} />);

    fireEvent.click(screen.getByTestId("mission-control-add-widget"));
    const search = await screen.findByTestId("mission-control-library-search");

    fireEvent.change(search, { target: { value: "activity" } });
    expect(
      screen.getByTestId(
        "mission-control-widget-picker-item-core.activity-overview"
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(
        "mission-control-widget-picker-item-core.system-resources"
      )
    ).not.toBeInTheDocument();
  });

  it("物料库弹窗尺寸与设置弹窗对齐", async () => {
    const props = makeProps({ widgets: [] });
    render(<MissionControlPanel {...props} />);

    fireEvent.click(screen.getByTestId("mission-control-add-widget"));
    const dialog = await screen.findByTestId("mission-control-library");

    expect(dialog.className).toContain("h-[90vh]");
    expect(dialog.className).toContain("max-h-[900px]");
    expect(dialog.className).toContain("max-w-[1200px]");
    expect(dialog.className).toContain("sm:max-w-[1200px]");
  });

  it("物料库不暴露裸网格尺寸徽标", async () => {
    const props = makeProps({ widgets: [] });
    render(<MissionControlPanel {...props} />);

    fireEvent.click(screen.getByTestId("mission-control-add-widget"));
    await screen.findByTestId("mission-control-library");

    expect(screen.queryByText(/\d+×\d+/)).not.toBeInTheDocument();
  });

  it("单实例物料已添加后在库中禁点，多实例物料可重复添加", async () => {
    const props = makeProps({
      widgets: [
        { h: 3, id: "core.activity-overview", w: 4, x: 0, y: 0 },
        {
          h: 4,
          id: "instance-1",
          w: 3,
          widgetId: "core.custom-card",
          x: 4,
          y: 0,
        },
      ],
    });
    render(<MissionControlPanel {...props} />);

    fireEvent.click(screen.getByTestId("mission-control-add-widget"));
    await screen.findByTestId("mission-control-library");

    expect(
      screen.getByTestId(
        "mission-control-widget-picker-item-core.activity-overview"
      )
    ).toBeDisabled();
    expect(
      screen.getByTestId("mission-control-widget-picker-item-core.custom-card")
    ).not.toBeDisabled();
  });

  it("空态只显示添加物料入口，不再显示快速开始预设", () => {
    const updateParameters = vi.fn();
    const props = makeProps({ widgets: [] }, updateParameters);
    render(<MissionControlPanel {...props} />);

    expect(
      screen.getByTestId("mission-control-add-widget")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("mission-control-preset-agent-workbench")
    ).not.toBeInTheDocument();
  });
});

describe("实例模型与锁定", () => {
  it("v2 条目（uuid 实例 + widgetId）按实例 id 渲染并带 data-widget-id", () => {
    const props = makeProps({
      widgets: [
        {
          h: 3,
          id: "1c8b6ee2-0000-0000-0000-000000000000",
          w: 4,
          widgetId: "core.activity-overview",
          x: 0,
          y: 0,
        },
      ],
    });
    render(<MissionControlPanel {...props} />);
    const card = screen.getByTestId(
      "mission-control-widget-1c8b6ee2-0000-0000-0000-000000000000"
    );
    expect(card).toHaveAttribute("data-widget-id", "core.activity-overview");
  });

  it("multiInstance 物料的菜单提供复制，复制条目为新实例且保留 params", async () => {
    const updateParameters = vi.fn();
    const props = makeProps(
      {
        widgets: [
          {
            h: 4,
            id: "instance-1",
            params: { blocks: [] },
            w: 3,
            widgetId: "core.custom-card",
            x: 0,
            y: 0,
          },
        ],
      },
      updateParameters
    );
    render(<MissionControlPanel {...props} />);

    openWidgetMenu();
    fireEvent.click(
      await screen.findByTestId("mission-control-widget-menu-duplicate")
    );

    expect(updateParameters).toHaveBeenCalledTimes(1);
    const payload = updateParameters.mock.calls[0]?.[0] as {
      widgets: {
        id: string;
        params?: Record<string, unknown>;
        widgetId?: string;
      }[];
    };
    expect(payload.widgets).toHaveLength(2);
    expect(payload.widgets[1]?.widgetId).toBe("core.custom-card");
    expect(payload.widgets[1]?.id).not.toBe("instance-1");
    expect(payload.widgets[1]?.params).toEqual({ blocks: [] });
  });

  it("configurable 物料从菜单打开设置 Sheet", async () => {
    const props = makeProps({
      widgets: [
        {
          h: 4,
          id: "instance-1",
          w: 3,
          widgetId: "core.custom-card",
          x: 0,
          y: 0,
        },
      ],
    });
    render(<MissionControlPanel {...props} />);

    openWidgetMenu();
    fireEvent.click(
      await screen.findByTestId("mission-control-widget-menu-settings")
    );

    expect(
      await screen.findByTestId("mission-control-widget-settings-sheet")
    ).toBeInTheDocument();
  });

  it("锁定布局：隐藏幽灵添加卡与编辑菜单", () => {
    const props = makeProps({
      locked: true,
      widgets: [{ h: 3, id: "core.activity-overview", w: 4, x: 0, y: 0 }],
    });
    render(<MissionControlPanel {...props} />);

    expect(
      screen.queryByTestId("mission-control-add-widget")
    ).not.toBeInTheDocument();
    // activity-overview 无 refresh/settings 能力，锁定后菜单整体不渲染
    expect(screen.queryByLabelText(MENU_LABEL_RE)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(REMOVE_LABEL_RE)).not.toBeInTheDocument();
  });

  it("锁定空布局：隐藏空态添加入口", () => {
    const props = makeProps({ locked: true, widgets: [] });
    render(<MissionControlPanel {...props} />);

    expect(screen.getByTestId("mission-control-empty")).toBeInTheDocument();
    expect(
      screen.queryByTestId("mission-control-add-widget")
    ).not.toBeInTheDocument();
  });

  it("锁定布局：保留刷新和设置，隐藏复制和移除", async () => {
    function TestWidget(_props: MissionControlWidgetComponentProps) {
      return <div>locked widget</div>;
    }
    function TestSettings() {
      return <div>locked settings</div>;
    }

    registerPluginMissionControlWidget({
      component: TestWidget,
      icon: AlertTriangle,
      id: "pier.locked.widget",
      settingsComponent: TestSettings,
    });
    setPluginRegistry([
      {
        effectivePermissions: [],
        enabled: true,
        manifest: {
          apiVersion: 1,
          commands: [],
          missionControlWidgets: [
            {
              configurable: true,
              id: "pier.locked.widget",
              multiInstance: true,
              permissions: [],
              refreshable: true,
              title: "Locked",
            },
          ],
          engines: { pier: ">=0.1.0" },
          id: "pier.locked",
          name: "Locked",
          panels: [],
          permissions: [],
          source: { kind: "builtin" },
          terminalStatusItems: [],
          version: "1.0.0",
        },
        runtime: { canToggle: true, enabled: true, kind: "builtin" },
      },
    ] as never);

    const props = makeProps({
      locked: true,
      widgets: [{ h: 3, id: "pier.locked.widget", w: 4, x: 0, y: 0 }],
    });
    render(<MissionControlPanel {...props} />);

    openWidgetMenu();

    expect(await screen.findByText(/^Refresh$/i)).toBeInTheDocument();
    expect(
      await screen.findByTestId("mission-control-widget-menu-settings")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("mission-control-widget-menu-duplicate")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("mission-control-widget-menu-remove")
    ).not.toBeInTheDocument();
  });

  it("切换锁定状态时保留现有 widgets", async () => {
    const updateParameters = vi.fn();
    const widgets = [{ h: 3, id: "core.activity-overview", w: 4, x: 0, y: 0 }];
    const props = makeProps({ widgets }, updateParameters);
    render(<MissionControlPanel {...props} />);

    openPanelContextMenu();
    fireEvent.click(await screen.findByTestId("mission-control-toggle-lock"));

    expect(updateParameters).toHaveBeenCalledWith({
      locked: true,
      widgets,
    });
  });

  it("锁定状态下设置写回保留 locked", async () => {
    function TestWidget(_props: MissionControlWidgetComponentProps) {
      return <div>locked configurable widget</div>;
    }
    function TestSettings({ updateParams }: MissionControlWidgetSettingsProps) {
      return (
        <button
          data-testid="mission-control-test-settings-write"
          onClick={() => updateParams({ enabled: true })}
          type="button"
        >
          Write
        </button>
      );
    }

    registerPluginMissionControlWidget({
      component: TestWidget,
      icon: AlertTriangle,
      id: "pier.locked.settings-widget",
      settingsComponent: TestSettings,
    });
    setPluginRegistry([
      {
        effectivePermissions: [],
        enabled: true,
        manifest: {
          apiVersion: 1,
          commands: [],
          missionControlWidgets: [
            {
              configurable: true,
              id: "pier.locked.settings-widget",
              permissions: [],
              title: "Locked Settings",
            },
          ],
          engines: { pier: ">=0.1.0" },
          id: "pier.locked.settings",
          name: "Locked Settings",
          panels: [],
          permissions: [],
          source: { kind: "builtin" },
          terminalStatusItems: [],
          version: "1.0.0",
        },
        runtime: { canToggle: true, enabled: true, kind: "builtin" },
      },
    ] as never);

    const updateParameters = vi.fn();
    const widgets = [
      {
        h: 3,
        id: "pier.locked.settings-widget",
        w: 4,
        x: 0,
        y: 0,
      },
    ];
    const props = makeProps({ locked: true, widgets }, updateParameters);
    render(<MissionControlPanel {...props} />);

    openWidgetMenu();
    fireEvent.click(
      await screen.findByTestId("mission-control-widget-menu-settings")
    );
    fireEvent.click(
      await screen.findByTestId("mission-control-test-settings-write")
    );

    expect(updateParameters).toHaveBeenCalledWith({
      locked: true,
      widgets: [
        {
          ...widgets[0],
          params: { enabled: true },
        },
      ],
    });
  });
});

describe("固定格宽与派生模式", () => {
  it("12 列默认尊重持久化尺寸，不自动扩宽核心物料", () => {
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({
        bottom: 0,
        height: 800,
        left: 0,
        right: 1300,
        toJSON: () => ({}),
        top: 0,
        width: 1300,
        x: 0,
        y: 0,
      });
    const props = makeProps({
      widgets: [
        { h: 3, id: "core.activity-overview", w: 4, x: 0, y: 0 },
        { h: 4, id: "core.system-resources", w: 4, x: 4, y: 0 },
      ],
    });

    const { container } = render(<MissionControlPanel {...props} />);

    const items = [...container.querySelectorAll(".react-grid-item")];
    expect(items[0]).toHaveStyle({ width: "388px" });
    expect(items[1]).toHaveStyle({ width: "388px" });

    rectSpy.mockRestore();
  });

  it("显式整理布局才运行自动布局求解并写回 12 列基准", async () => {
    const updateParameters = vi.fn();
    const props = makeProps(
      {
        widgets: [
          { h: 3, id: "core.activity-overview", w: 4, x: 0, y: 0 },
          { h: 4, id: "core.system-resources", w: 4, x: 4, y: 0 },
        ],
      },
      updateParameters
    );

    render(<MissionControlPanel {...props} />);
    openPanelContextMenu();
    fireEvent.click(
      await screen.findByTestId("mission-control-arrange-layout")
    );

    expect(updateParameters).toHaveBeenCalledWith({
      widgets: [
        { h: 3, id: "core.activity-overview", w: 6, x: 0, y: 0 },
        { h: 4, id: "core.system-resources", w: 6, x: 6, y: 0 },
      ],
    });
  });

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
    // w=12 的卡片在 k=8 下会派生为 8 列展示；若守卫失效，
    // RGL 首次 onLayoutChange 会把屏幕列数写回 params。
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

describe("P0 toolbar chrome", () => {
  it("renders toolbar actions without opening context menu", () => {
    const props = makeProps({
      widgets: [{ h: 3, id: "core.activity-overview", w: 4, x: 0, y: 0 }],
    });
    render(<MissionControlPanel {...props} />);

    expect(screen.getByTestId("mission-control-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("mission-control-toolbar-add")).toBeEnabled();
    expect(
      screen.getByTestId("mission-control-toolbar-refresh-all")
    ).toBeInTheDocument();
    expect(screen.getByTestId("mission-control-toolbar-arrange")).toBeEnabled();
    expect(
      screen.getByTestId("mission-control-toolbar-lock")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("mission-control-locked-banner")
    ).not.toBeInTheDocument();
  });

  it("shows locked banner and disables add/arrange when locked", () => {
    const props = makeProps({
      locked: true,
      widgets: [{ h: 3, id: "core.activity-overview", w: 4, x: 0, y: 0 }],
    });
    render(<MissionControlPanel {...props} />);

    expect(
      screen.getByTestId("mission-control-locked-banner")
    ).toBeInTheDocument();
    expect(screen.getByTestId("mission-control-toolbar-add")).toBeDisabled();
    expect(
      screen.getByTestId("mission-control-toolbar-arrange")
    ).toBeDisabled();
  });

  it("locked empty state uses locked copy and hides add CTA", () => {
    const props = makeProps({ locked: true, widgets: [] });
    render(<MissionControlPanel {...props} />);

    expect(screen.getByTestId("mission-control-empty")).toHaveTextContent(
      /locked/i
    );
    expect(
      screen.queryByTestId("mission-control-add-widget")
    ).not.toBeInTheDocument();
  });

  it("toasts after explicit arrange layout writeback", async () => {
    const updateParameters = vi.fn();
    const props = makeProps(
      {
        widgets: [
          { h: 3, id: "core.activity-overview", w: 4, x: 0, y: 0 },
          { h: 3, id: "core.system-resources", w: 4, x: 4, y: 0 },
        ],
      },
      updateParameters
    );
    render(<MissionControlPanel {...props} />);
    fireEvent.click(screen.getByTestId("mission-control-toolbar-arrange"));

    await vi.waitFor(() => {
      expect(updateParameters).toHaveBeenCalled();
    });
    expect(toast.success).toHaveBeenCalled();
  });
});
