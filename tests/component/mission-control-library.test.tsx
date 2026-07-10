import type {
  MissionControlWidgetComponentProps,
  RendererMissionControlWidgetRegistration,
} from "@plugins/api/renderer.ts";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { AlertTriangle } from "lucide-react";
import { describe, expect, it, type Mock, vi } from "vitest";
import { registerPluginMissionControlWidget } from "@/lib/plugins/plugin-mission-control-widget-registry.ts";
import { MissionControlPanel } from "@/panel-kits/mission-control/mission-control-panel.tsx";
import { useAppDialogStore } from "@/stores/app-dialog.store.ts";
import {
  installMissionControlTestHarness,
  makePluginRegistryEntry,
  makeProps,
  openWidgetMenu,
  setPluginRegistry,
} from "./mission-control-test-harness.ts";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

installMissionControlTestHarness();

function renderPanel(
  params: Record<string, unknown>,
  updateParameters: Mock = vi.fn()
) {
  return render(
    <MissionControlPanel {...makeProps(params, updateParameters)} />
  );
}

describe("Mission Control widget rendering", () => {
  it("renders plugin-disabled placeholder when plugin is disabled", () => {
    setPluginRegistry([
      makePluginRegistryEntry({
        enabled: false,
        pluginId: "pier.test",
        widgets: [{ id: "pier.test.widget", permissions: [], title: "Test" }],
      }),
    ]);

    renderPanel({
      widgets: [{ h: 3, id: "pier.test.widget", w: 4, x: 0, y: 0 }],
    });
    expect(
      screen.getByTestId("mission-control-widget-pier.test.widget")
    ).toBeInTheDocument();
  });

  it("asks for confirmation before removing unknown widget inline", async () => {
    const updateParameters = vi.fn();
    renderPanel(
      {
        widgets: [
          {
            h: 3,
            id: "orphan-instance",
            w: 4,
            widgetId: "pier.removed.widget",
            x: 0,
            y: 0,
          },
        ],
      },
      updateParameters
    );

    expect(screen.getByText(/Widget unavailable/i)).toBeInTheDocument();
    fireEvent.click(
      screen.getByTestId("mission-control-widget-unknown-remove")
    );
    const dialog = useAppDialogStore.getState().current;
    expect(dialog?.kind).toBe("confirm");
    expect(updateParameters).not.toHaveBeenCalled();

    if (dialog?.kind === "confirm" || dialog?.kind === "alert") {
      await act(async () => dialog.resolve(true));
    }
    await vi.waitFor(() => {
      expect(updateParameters).toHaveBeenCalledWith({
        layoutVersion: 3,
        widgets: [],
      });
    });
  });

  it("asks for confirmation before removing a widget", async () => {
    const updateParameters = vi.fn();
    renderPanel(
      {
        widgets: [{ h: 3, id: "core.activity-overview", w: 4, x: 0, y: 0 }],
      },
      updateParameters
    );
    openWidgetMenu();
    fireEvent.click(
      await screen.findByTestId("mission-control-widget-menu-remove")
    );

    const dialog = useAppDialogStore.getState().current;
    expect(dialog?.kind).toBe("confirm");
    expect(updateParameters).not.toHaveBeenCalled();
    if (dialog?.kind === "confirm" || dialog?.kind === "alert") {
      await act(async () => dialog.resolve(false));
    }
    expect(updateParameters).not.toHaveBeenCalled();

    fireEvent.click(
      await screen.findByTestId("mission-control-widget-menu-remove")
    );
    const confirmedDialog = useAppDialogStore.getState().current;
    if (
      confirmedDialog?.kind === "confirm" ||
      confirmedDialog?.kind === "alert"
    ) {
      await act(async () => confirmedDialog.resolve(true));
    }
    await vi.waitFor(() => {
      expect(updateParameters).toHaveBeenCalledWith({
        layoutVersion: 3,
        widgets: [],
      });
    });
  });

  it("card menu does not expose manual resize presets", async () => {
    renderPanel({
      widgets: [{ h: 3, id: "core.activity-overview", w: 4, x: 0, y: 0 }],
    });
    openWidgetMenu();

    expect(
      await screen.findByTestId("mission-control-widget-menu-remove")
    ).toBeInTheDocument();
    expect(screen.queryByText(/^resize$/i)).not.toBeInTheDocument();
  });

  it("catches widget errors and resets the boundary through refresh", async () => {
    let shouldCrash = true;
    function CrashingWidget(_props: MissionControlWidgetComponentProps) {
      if (shouldCrash) {
        throw new Error("widget boom");
      }
      return <div>widget recovered</div>;
    }
    const crashRegistration: RendererMissionControlWidgetRegistration = {
      component: CrashingWidget,
      icon: AlertTriangle,
      id: "pier.crash.widget",
    };
    registerPluginMissionControlWidget(crashRegistration);
    setPluginRegistry([
      makePluginRegistryEntry({
        pluginId: "pier.crash",
        widgets: [{ id: "pier.crash.widget", permissions: [], title: "Crash" }],
      }),
    ]);
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    renderPanel({
      widgets: [{ h: 3, id: "pier.crash.widget", w: 4, x: 0, y: 0 }],
    });
    expect(screen.getByText("widget boom")).toBeInTheDocument();
    expect(document.querySelector('[data-slot="widget-error"]')).toBeTruthy();
    shouldCrash = false;
    fireEvent.click(screen.getByText(/retry/i));
    expect(await screen.findByText("widget recovered")).toBeInTheDocument();
    consoleSpy.mockRestore();
  });

  it("system resources exposes its declared card-level refresh action", async () => {
    renderPanel({
      layoutVersion: 3,
      widgets: [{ h: 4, id: "core.system-resources", w: 4 }],
    });
    openWidgetMenu();

    expect(await screen.findByText(/^Refresh$/i)).toBeInTheDocument();
  });

  it("首渲后注册的插件 widget 从骨架屏占位切换为真实组件", () => {
    setPluginRegistry([
      makePluginRegistryEntry({
        pluginId: "pier.late",
        widgets: [{ id: "pier.late.widget", permissions: [], title: "Late" }],
      }),
    ]);
    renderPanel({
      widgets: [{ h: 3, id: "pier.late.widget", w: 4, x: 0, y: 0 }],
    });
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
});

describe("物料库对话框", () => {
  it("点击添加入口打开物料库，选择物料后写入 v3 条目并关闭", async () => {
    const updateParameters = vi.fn();
    renderPanel({ widgets: [] }, updateParameters);

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
      layoutVersion: 3,
      widgets: [
        {
          h: 3,
          id: "core.activity-overview",
          w: 4,
          widgetId: "core.activity-overview",
        },
      ],
    });
    expect(
      screen.queryByTestId("mission-control-library")
    ).not.toBeInTheDocument();
  });

  it("物料库支持搜索过滤", async () => {
    render(<MissionControlPanel {...makeProps({ widgets: [] })} />);
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
    render(<MissionControlPanel {...makeProps({ widgets: [] })} />);
    fireEvent.click(screen.getByTestId("mission-control-add-widget"));
    const dialog = await screen.findByTestId("mission-control-library");

    expect(dialog.className).toContain("h-[90vh]");
    expect(dialog.className).toContain("max-h-[900px]");
    expect(dialog.className).toContain("max-w-[1200px]");
    expect(dialog.className).toContain("sm:max-w-[1200px]");
  });

  it("物料库不暴露裸网格尺寸徽标", async () => {
    render(<MissionControlPanel {...makeProps({ widgets: [] })} />);
    fireEvent.click(screen.getByTestId("mission-control-add-widget"));
    await screen.findByTestId("mission-control-library");
    expect(screen.queryByText(/\d+×\d+/)).not.toBeInTheDocument();
  });

  it("单实例物料已添加后在库中禁点，多实例物料可重复添加", async () => {
    renderPanel({
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
    render(<MissionControlPanel {...makeProps({ widgets: [] })} />);
    expect(
      screen.getByTestId("mission-control-add-widget")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("mission-control-preset-agent-workbench")
    ).not.toBeInTheDocument();
  });
});

describe("实例模型与组件菜单", () => {
  it("v3 条目（uuid 实例 + widgetId）按实例 id 渲染并带 data-widget-id", () => {
    renderPanel({
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
    expect(
      screen.getByTestId(
        "mission-control-widget-1c8b6ee2-0000-0000-0000-000000000000"
      )
    ).toHaveAttribute("data-widget-id", "core.activity-overview");
  });

  it("multiInstance 物料的菜单提供复制，复制条目为新实例且保留 params", async () => {
    const updateParameters = vi.fn();
    renderPanel(
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

  it("configurable 物料从菜单打开设置弹窗", async () => {
    renderPanel({
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
    openWidgetMenu();
    fireEvent.click(
      await screen.findByTestId("mission-control-widget-menu-settings")
    );
    expect(
      await screen.findByTestId("mission-control-widget-settings-dialog")
    ).toHaveAttribute("role", "dialog");
  });
});
