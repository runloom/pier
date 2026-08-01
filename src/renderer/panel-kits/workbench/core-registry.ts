import type { RendererWorkbenchWidgetRegistration } from "@plugins/api/renderer.ts";
import type { CoreWorkbenchWidgetDeclaration } from "@shared/contracts/workbench.ts";
import {
  CORE_ACTIVITY_OVERVIEW_WIDGET_ID,
  CORE_COST_OVERVIEW_WIDGET_ID,
  CORE_CUSTOM_CARD_WIDGET_ID,
  CORE_SYSTEM_RESOURCES_WIDGET_ID,
} from "@shared/plugin-core-contribution-ids.ts";
import { Activity, Blocks, Cpu, DollarSign } from "lucide-react";
import { ActivityWidget } from "./core-widgets/activity-widget.tsx";
import { CostOverviewSettings } from "./core-widgets/cost/overview-settings.tsx";
import {
  CostOverviewWidget,
  costOverviewWidgetActions,
} from "./core-widgets/cost-overview-widget.tsx";
import { CustomCardSettings } from "./core-widgets/custom-card/settings.tsx";
import { CustomCardWidget } from "./core-widgets/custom-card/widget.tsx";
import { SystemResourcesWidget } from "./core-widgets/system-resources-widget.tsx";
import {
  ActivityWidgetPreview,
  CostOverviewWidgetPreview,
  CustomCardWidgetPreview,
  SystemResourcesWidgetPreview,
} from "./core-widgets/widget-previews.tsx";

export const CORE_WORKBENCH_WIDGETS: readonly CoreWorkbenchWidgetDeclaration[] =
  [
    {
      category: "agent",
      defaultSize: { h: 3, w: 4 },
      descriptionKey: "workbench.widget.activityOverview.description",
      id: CORE_ACTIVITY_OVERVIEW_WIDGET_ID,
      searchTerms: [
        "activity",
        "agent",
        "session",
        "needs you",
        "活动",
        "会话",
        "需要你处理",
        "智能体",
      ],
      maxSize: { h: 12, w: 12 },
      minSize: { h: 2, w: 3 },
      titleKey: "workbench.widget.activityOverview.title",
    },
    {
      category: "system",
      defaultSize: { h: 4, w: 4 },
      descriptionKey: "workbench.widget.systemResources.description",
      id: CORE_SYSTEM_RESOURCES_WIDGET_ID,
      searchTerms: [
        "cpu",
        "memory",
        "terminal",
        "agent",
        "process",
        "内存",
        "终端",
        "智能体",
        "进程",
        "资源",
      ],
      maxSize: { h: 12, w: 12 },
      minSize: { h: 2, w: 2 },
      refreshable: true,
      titleKey: "workbench.widget.systemResources.title",
    },
    {
      category: "custom",
      configurable: true,
      defaultSize: { h: 4, w: 3 },
      descriptionKey: "workbench.widget.customCard.description",
      id: CORE_CUSTOM_CARD_WIDGET_ID,
      searchTerms: ["custom", "kpi", "metric", "自定义", "指标", "组装"],
      maxSize: { h: 12, w: 6 },
      minSize: { h: 2, w: 2 },
      multiInstance: true,
      titleKey: "workbench.widget.customCard.title",
    },
    {
      category: "analytics",
      configurable: true,
      defaultSize: { h: 3, w: 4 },
      descriptionKey: "workbench.widget.costOverview.description",
      id: CORE_COST_OVERVIEW_WIDGET_ID,
      searchTerms: [
        "cost",
        "spending",
        "tokens",
        "usage",
        "model",
        "source",
        "trend",
        "成本",
        "花费",
        "令牌",
        "模型",
        "来源",
        "趋势",
      ],
      maxSize: { h: 5, w: 8 },
      // h≤2 / w≤2: compact 密度只保留主数字（无图、无滚动）；
      // h=3 medium 少量 KPI+图；h≥4 full 完整说明与 KPI。
      minSize: { h: 2, w: 2 },
      multiInstance: true,
      // refreshable=false：改用 registration 里的 async action，让 header 刷新
      // 按钮 spinner 覆盖真实 refreshAll 耗时。
      refreshable: false,
      titleKey: "workbench.widget.costOverview.title",
    },
  ];

/**
 * core widget id → 运行时注册信息（含组件）。
 * 与 CORE_WORKBENCH_WIDGETS 声明表一一对应，工作台合并层消费。
 */
export const CORE_WORKBENCH_WIDGET_COMPONENTS: ReadonlyMap<
  string,
  RendererWorkbenchWidgetRegistration
> = new Map([
  [
    CORE_ACTIVITY_OVERVIEW_WIDGET_ID,
    {
      component: ActivityWidget,
      contentMode: "contained",
      icon: Activity,
      id: CORE_ACTIVITY_OVERVIEW_WIDGET_ID,
      previewComponent: ActivityWidgetPreview,
    },
  ],
  [
    CORE_SYSTEM_RESOURCES_WIDGET_ID,
    {
      component: SystemResourcesWidget,
      contentMode: "contained",
      icon: Cpu,
      id: CORE_SYSTEM_RESOURCES_WIDGET_ID,
      previewComponent: SystemResourcesWidgetPreview,
    },
  ],
  [
    CORE_CUSTOM_CARD_WIDGET_ID,
    {
      component: CustomCardWidget,
      contentMode: "contained",
      icon: Blocks,
      id: CORE_CUSTOM_CARD_WIDGET_ID,
      previewComponent: CustomCardWidgetPreview,
      settingsComponent: CustomCardSettings,
    },
  ],
  [
    CORE_COST_OVERVIEW_WIDGET_ID,
    {
      actions: costOverviewWidgetActions,
      component: CostOverviewWidget,
      contentMode: "contained",
      icon: DollarSign,
      id: CORE_COST_OVERVIEW_WIDGET_ID,
      previewComponent: CostOverviewWidgetPreview,
      settingsComponent: CostOverviewSettings,
    },
  ],
]);
